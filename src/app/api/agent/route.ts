import { NextRequest } from "next/server";
import { hasAccess } from "@/lib/agent/auth";
import { runAgent, type AgentBrief, type AgentEvent } from "@/lib/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  // Checked before parsing the body, so a wrong code costs nothing.
  if (!hasAccess(req)) {
    return Response.json({ error: "access code required", code: "unauthorized" }, { status: 401 });
  }

  let brief: AgentBrief;
  try {
    brief = (await req.json()) as AgentBrief;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof brief.useCase !== "string" || brief.useCase.trim().length < 10) {
    return Response.json(
      { error: "Describe what you are building — a sentence or two is enough." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await runAgent(
          {
            useCase: brief.useCase.slice(0, 4000),
            maxPriceUsd: Number.isFinite(brief.maxPriceUsd) ? brief.maxPriceUsd : undefined,
            categories: Array.isArray(brief.categories) ? brief.categories : undefined,
            maxTldLength: Number.isFinite(brief.maxTldLength) ? brief.maxTldLength : undefined,
            seedNames: Array.isArray(brief.seedNames) ? brief.seedNames.slice(0, 10) : undefined,
            depth: brief.depth === "quick" || brief.depth === "deep" ? brief.depth : "normal",
          },
          send,
          req.signal,
        );
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Agent failed." });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* client disconnected */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

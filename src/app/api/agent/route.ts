import { NextRequest } from "next/server";
import { hasAccess } from "@/lib/agent/auth";
import { runAgent, type AgentBrief } from "@/lib/agent/run";
import { appendEvent, atCapacity, createRun, finishRun, listRuns } from "@/lib/agent/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Past searches, newest first. */
export async function GET(req: NextRequest) {
  if (!hasAccess(req)) {
    return Response.json({ error: "access code required", code: "unauthorized" }, { status: 401 });
  }
  return Response.json({ runs: await listRuns() });
}

/**
 * Starts a run and returns its id immediately. The work is deliberately not
 * tied to this request — the client attaches to /api/agent/stream afterwards,
 * and a dropped connection costs it nothing but the live view.
 */
export async function POST(req: NextRequest) {
  if (!hasAccess(req)) {
    return Response.json({ error: "access code required", code: "unauthorized" }, { status: 401 });
  }

  let input: AgentBrief;
  try {
    input = (await req.json()) as AgentBrief;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof input.useCase !== "string" || input.useCase.trim().length < 10) {
    return Response.json(
      { error: "Describe what you are building — a sentence or two is enough." },
      { status: 400 },
    );
  }

  if (atCapacity()) {
    return Response.json(
      { error: "Two runs are already going. Wait for one to finish, or stop it." },
      { status: 429 },
    );
  }

  const brief: AgentBrief = {
    useCase: input.useCase.slice(0, 4000),
    maxPriceUsd: Number.isFinite(input.maxPriceUsd) ? input.maxPriceUsd : undefined,
    categories: Array.isArray(input.categories) ? input.categories : undefined,
    maxTldLength: Number.isFinite(input.maxTldLength) ? input.maxTldLength : undefined,
    seedNames: Array.isArray(input.seedNames) ? input.seedNames.slice(0, 10) : undefined,
    depth: input.depth === "quick" || input.depth === "deep" ? input.depth : "normal",
  };

  const { id, signal } = createRun(brief);

  // Detached on purpose: the run belongs to the server, not to this socket.
  let reason: string | undefined;
  void runAgent(
    brief,
    (event) => {
      // The store emits the single terminal event; capture the nuance first.
      if (event.type === "done") {
        reason = event.reason;
        return;
      }
      appendEvent(id, event);
    },
    signal,
  )
    .then(() => finishRun(id, signal.aborted ? "stopped" : "done", reason ?? "finished"))
    .catch((err: unknown) => {
      appendEvent(id, {
        type: "error",
        message: err instanceof Error ? err.message : "Agent failed.",
      });
      finishRun(id, "error");
    });

  return Response.json({ runId: id });
}

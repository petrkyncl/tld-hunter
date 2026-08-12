import { NextRequest } from "next/server";
import { buildTargets, normalizeQuery, scan } from "@/lib/scan";
import type { ScanMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const normalized = normalizeQuery(params.get("q") ?? "");

  if ("error" in normalized) {
    return Response.json({ error: normalized.error }, { status: 400 });
  }

  const verify = params.get("verify") !== "0";
  const limitParam = Number(params.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (msg: ScanMessage) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(msg)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const { list, pricing } = await buildTargets(limit);
        send({
          type: "meta",
          total: list.length,
          query: normalized.label,
          pricedCount: Object.keys(pricing).length,
        });

        const scanned = await scan(
          normalized.label,
          { verify, limit, signal: req.signal },
          {
            result: (r) => send({ type: "result", ...r }),
            update: (u) => send({ type: "update", ...u }),
            phase: (p) => send({ type: "phase", ...p }),
          },
        );

        send({ type: "done", scanned, ms: Date.now() - started });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "Scan failed" });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client disconnecting */
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

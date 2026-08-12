import { NextRequest } from "next/server";
import { hasAccess } from "@/lib/agent/auth";
import { attach, getRun } from "@/lib/agent/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * Replays a run from `from`, then follows it live. Reconnecting after a
 * dropped connection is the same call with a higher `from`, so nothing is
 * missed and nothing arrives twice.
 */
export async function GET(req: NextRequest) {
  if (!hasAccess(req)) {
    return Response.json({ error: "access code required", code: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const from = Math.max(0, Number(req.nextUrl.searchParams.get("from")) || 0);

  const record = await getRun(id);
  if (!record) return Response.json({ error: "No such run." }, { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already gone */
        }
      };

      const { backlog, done, detach } = attach(id, from, (event, index) => {
        send({ index, event });
        if (event.type === "done") {
          detachAll();
          finish();
        }
      });

      let detachAll = detach;

      for (const item of backlog) send({ index: item.index, event: item.event });

      if (done) {
        // Finished before we attached — replay the archived tail and close.
        if (!backlog.length) {
          record.events.slice(from).forEach((event, i) => send({ index: from + i, event }));
        }
        finish();
        return;
      }

      // A client that navigates away should not leave a subscriber behind.
      req.signal.addEventListener("abort", () => {
        detachAll();
        detachAll = () => {};
        finish();
      });
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

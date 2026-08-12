import { NextRequest } from "next/server";
import { hasAccess } from "@/lib/agent/auth";
import { stopRun } from "@/lib/agent/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stopping is now an explicit act — closing the tab no longer counts as one. */
export async function POST(req: NextRequest) {
  if (!hasAccess(req)) {
    return Response.json({ error: "access code required", code: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  return Response.json({ stopped: stopRun(id) });
}

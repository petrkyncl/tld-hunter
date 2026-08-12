import { NextRequest } from "next/server";
import { pooled } from "@/lib/pool";
import { rdapLookup } from "@/lib/rdap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BATCH = 60;

interface Target {
  domain: string;
  tld: string;
}

/** On-demand authoritative check for rows the user is actually looking at. */
export async function POST(req: NextRequest) {
  let body: { targets?: Target[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const targets = (body.targets ?? [])
    .filter(
      (t): t is Target =>
        typeof t?.domain === "string" &&
        typeof t?.tld === "string" &&
        /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t.domain),
    )
    .slice(0, MAX_BATCH);

  if (!targets.length) return Response.json({ results: [] });

  const results: Array<{ tld: string; verdict: string }> = [];
  await pooled(
    targets,
    12,
    (t) => rdapLookup(t.domain, t.tld, { signal: req.signal }),
    (r, t) => results.push({ tld: t.tld, verdict: r.verdict }),
    req.signal,
  );

  return Response.json({ results });
}

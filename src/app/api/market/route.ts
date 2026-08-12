import { NextRequest } from "next/server";
import { lookupListing } from "@/lib/market";
import { pooled } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BATCH = 25;

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!domain) return Response.json({ error: "A domain is required." }, { status: 400 });

  return Response.json(await lookupListing(domain, req.signal));
}

/** Batch lookup for the rows the user is currently looking at. */
export async function POST(req: NextRequest) {
  let body: { domains?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const domains = (body.domains ?? [])
    .filter((d): d is string => typeof d === "string")
    .slice(0, MAX_BATCH);

  if (!domains.length) return Response.json({ listings: [] });

  const listings: Awaited<ReturnType<typeof lookupListing>>[] = [];
  await pooled(
    domains,
    4,
    (d) => lookupListing(d, req.signal),
    (l) => listings.push(l),
    req.signal,
  );

  return Response.json({ listings });
}

import { buildTargets, describeTld } from "@/lib/scan";

export const runtime = "nodejs";
export const revalidate = 3600;

/**
 * The full catalogue, served before any search runs, so the grid can render
 * every TLD as a pending tile immediately instead of an empty screen.
 */
export async function GET() {
  try {
    const { list, pricing } = await buildTargets();
    return Response.json({
      count: list.length,
      tlds: list.map(({ tld, rank }) => describeTld(tld, rank, pricing[tld])),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "TLD list unavailable." },
      { status: 502 },
    );
  }
}

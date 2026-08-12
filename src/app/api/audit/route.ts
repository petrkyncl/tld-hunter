import { NextRequest } from "next/server";
import { auditDomain } from "@/lib/audit";
import { cached, HOUR } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();

  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return Response.json({ error: "A valid domain is required." }, { status: 400 });
  }

  try {
    const report = await cached(`audit:${domain}`, 6 * HOUR, () =>
      auditDomain(domain, { signal: req.signal }),
    );
    return Response.json(report);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Audit failed." },
      { status: 502 },
    );
  }
}

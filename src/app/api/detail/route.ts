import { NextRequest } from "next/server";
import { aftermarketLinks } from "@/lib/parking";
import { rdapLookup, type RdapDomain } from "@/lib/rdap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PorkbunCheck {
  available?: boolean;
  price?: number;
  premium?: boolean;
  regularPrice?: number;
}

/**
 * Exact price including premium tiers is only available behind an API key.
 * Set PORKBUN_API_KEY + PORKBUN_SECRET_KEY in .env.local to light this up;
 * without them the app falls back to the public standard price list.
 */
async function porkbunCheck(domain: string): Promise<PorkbunCheck | undefined> {
  const apikey = process.env.PORKBUN_API_KEY;
  const secretapikey = process.env.PORKBUN_SECRET_KEY;
  if (!apikey || !secretapikey) return undefined;

  try {
    const res = await fetch(
      `https://api.porkbun.com/api/json/v3/domain/checkDomain/${encodeURIComponent(domain)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apikey, secretapikey }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
    if (!res.ok) return undefined;

    const json = (await res.json()) as {
      status?: string;
      response?: {
        avail?: string;
        premium?: string;
        price?: string;
        regularPrice?: string;
      };
    };
    if (json.status !== "SUCCESS" || !json.response) return undefined;

    return {
      available: json.response.avail === "yes",
      premium: json.response.premium === "yes",
      price: Number(json.response.price) || undefined,
      regularPrice: Number(json.response.regularPrice) || undefined,
    };
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  const tld = (req.nextUrl.searchParams.get("tld") ?? "").trim().toLowerCase();

  if (!domain || !tld || !/^[a-z0-9.-]+$/.test(domain)) {
    return Response.json({ error: "A valid domain is required." }, { status: 400 });
  }

  const [rdap, check] = await Promise.all([
    rdapLookup(domain, tld, { detail: true, signal: req.signal }),
    porkbunCheck(domain),
  ]);

  const whois: RdapDomain | undefined = rdap.data;

  return Response.json({
    domain,
    verdict: rdap.verdict,
    whois,
    check,
    aftermarket: aftermarketLinks(domain),
  });
}

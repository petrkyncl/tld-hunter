import { cached, HOUR } from "./cache";

const PORKBUN_PRICING = "https://api.porkbun.com/api/json/v3/pricing/get";

export interface Price {
  registration: number;
  renewal: number;
  transfer: number;
}

interface PorkbunEntry {
  registration?: string;
  renewal?: string;
  transfer?: string;
}

/**
 * Porkbun publishes its whole price list without authentication, which is the
 * only free source covering ~900 TLDs. Prices are USD, standard (non-premium)
 * tier — a premium domain can cost far more, see checkDomain in detail.ts.
 */
export async function getPricing(): Promise<Record<string, Price>> {
  return cached("pricing:porkbun", 12 * HOUR, async () => {
    const res = await fetch(PORKBUN_PRICING, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Porkbun pricing: HTTP ${res.status}`);

    const json = (await res.json()) as {
      status?: string;
      pricing?: Record<string, PorkbunEntry>;
    };
    if (json.status !== "SUCCESS" || !json.pricing) {
      throw new Error("Porkbun pricing: unexpected payload");
    }

    const out: Record<string, Price> = {};
    for (const [tld, p] of Object.entries(json.pricing)) {
      const registration = Number(p.registration);
      if (!Number.isFinite(registration)) continue;
      out[tld.toLowerCase()] = {
        registration,
        renewal: Number(p.renewal) || registration,
        transfer: Number(p.transfer) || registration,
      };
    }
    return out;
  });
}

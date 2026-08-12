import { withTimeout } from "./signal";

/**
 * DNS over HTTPS. Faster and far more parallel-friendly than the system
 * resolver, and it works from a container with no resolv.conf worth trusting.
 * Queries alternate between Cloudflare and Google so neither sees the full load;
 * a retry always lands on the other provider.
 */

const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
];

let cursor = 0;

export type DnsVerdict = "delegated" | "nxdomain" | "unknown";

export interface DnsAnswer {
  verdict: DnsVerdict;
  ns: string[];
}

interface DohResponse {
  Status?: number;
  Answer?: Array<{ type: number; data: string }>;
  Authority?: Array<{ type: number; data: string }>;
}

export async function lookupNs(domain: string, signal?: AbortSignal): Promise<DnsAnswer> {
  const start = cursor++;

  for (let attempt = 0; attempt < RESOLVERS.length; attempt++) {
    const base = RESOLVERS[(start + attempt) % RESOLVERS.length];
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(domain)}&type=NS`, {
        headers: { accept: "application/dns-json" },
        signal: withTimeout(6000, signal),
        cache: "no-store",
      });
      if (!res.ok) continue;

      const json = (await res.json()) as DohResponse;

      // NXDOMAIN: the parent zone says this name does not exist.
      if (json.Status === 3) return { verdict: "nxdomain", ns: [] };
      if (json.Status !== 0) return { verdict: "unknown", ns: [] };

      const ns = (json.Answer ?? [])
        .filter((r) => r.type === 2)
        .map((r) => r.data.replace(/\.$/, "").toLowerCase());

      if (ns.length) return { verdict: "delegated", ns };

      // NOERROR with only an SOA in authority = name exists but has no NS set;
      // anything else at this point we simply do not trust.
      const soaOnly = (json.Authority ?? []).some((r) => r.type === 6);
      return { verdict: soaOnly ? "unknown" : "delegated", ns: [] };
    } catch {
      if (signal?.aborted) break;
      // fall through to the other resolver
    }
  }
  return { verdict: "unknown", ns: [] };
}

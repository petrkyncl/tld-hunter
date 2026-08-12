import { lookupNs } from "@/lib/dns";
import { detectMarket } from "@/lib/parking";
import { pooled } from "@/lib/pool";
import { authoritative, buildTargets, describeTld, normalizeQuery } from "@/lib/scan";
import type { CategoryId } from "@/lib/categories";

/**
 * Targeted sweeps for the agent. The UI's full 1500-TLD scan takes minutes;
 * an agent that pays per token and per second needs an answer in seconds, so
 * these narrow the candidate set first and verify only what could actually be
 * recommended.
 */

export interface SweepFilters {
  /** Yearly renewal ceiling in USD — the number that actually matters long-term. */
  maxPriceUsd?: number;
  categories?: CategoryId[];
  /** Longest acceptable suffix, in characters. */
  maxTldLength?: number;
  /** Suffixes to always include regardless of the other filters. */
  mustInclude?: string[];
}

export interface SweepHit {
  domain: string;
  tld: string;
  price?: number;
  renew?: number;
  market?: string;
}

export interface SweepResult {
  name: string;
  checked: number;
  available: SweepHit[];
  forSale: SweepHit[];
  takenCount: number;
  /** Suffixes no registry would confirm — reported, never recommended. */
  unresolved: number;
}

const DNS_WIDTH = 64;
const VERIFY_WIDTH = 24;

/** Candidate suffixes worth spending a lookup on, most relevant first. */
async function candidates(filters: SweepFilters, limit: number) {
  const { list, pricing } = await buildTargets();
  const must = new Set((filters.mustInclude ?? []).map((t) => t.replace(/^\./, "").toLowerCase()));

  const described = list.map(({ tld, rank }) => describeTld(tld, rank, pricing[tld]));

  const forced = described.filter((d) => must.has(d.tld));
  const pool = described
    .filter((d) => !must.has(d.tld))
    .filter((d) => d.labels === 1)
    .filter((d) => /^[a-z0-9-]+$/.test(d.tldUnicode))
    .filter((d) => d.price !== undefined)
    .filter((d) => {
      const yearly = d.renew ?? d.price!;
      return filters.maxPriceUsd === undefined || yearly <= filters.maxPriceUsd;
    })
    .filter((d) => filters.maxTldLength === undefined || d.length <= filters.maxTldLength)
    .filter(
      (d) =>
        !filters.categories?.length ||
        filters.categories.some((c) => d.categories.includes(c)),
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);

  return [...forced, ...pool];
}

/**
 * One name against a filtered slice of the TLD space: DNS first, then registry
 * confirmation for the handful that look free. Only confirmed hits come back —
 * an agent must never recommend a name on a DNS guess.
 */
export async function sweepName(
  rawName: string,
  filters: SweepFilters = {},
  opts: { breadth?: number; verify?: number; signal?: AbortSignal } = {},
): Promise<SweepResult | { error: string }> {
  const normalized = normalizeQuery(rawName);
  if ("error" in normalized) return { error: normalized.error };
  const label = normalized.label;

  const targets = await candidates(filters, opts.breadth ?? 110);

  const free: typeof targets = [];
  const forSale: SweepHit[] = [];
  let takenCount = 0;
  let unresolved = 0;

  await pooled(
    targets,
    DNS_WIDTH,
    (t) => lookupNs(`${label}.${t.tld}`, opts.signal),
    (dns, t) => {
      const domain = `${label}.${t.tld}`;
      if (dns.verdict === "delegated") {
        const market = detectMarket(domain, dns.ns);
        if (market) {
          forSale.push({ domain, tld: t.tld, price: t.price, renew: t.renew, market: market.name });
        } else {
          takenCount++;
        }
        return;
      }
      free.push(t);
    },
    opts.signal,
  );

  // DNS says "no delegation", which is not the same as "unregistered" — confirm
  // the most relevant ones against the registry before reporting them.
  const toVerify = free.sort((a, b) => a.rank - b.rank).slice(0, opts.verify ?? 40);
  const available: SweepHit[] = [];

  await pooled(
    toVerify,
    VERIFY_WIDTH,
    (t) => authoritative(`${label}.${t.tld}`, t.tld, opts.signal),
    (verdict, t) => {
      if (verdict?.status === "free") {
        available.push({
          domain: `${label}.${t.tld}`,
          tld: t.tld,
          price: t.price,
          renew: t.renew,
        });
      } else if (verdict?.status === "taken") takenCount++;
      else unresolved++;
    },
    opts.signal,
  );

  available.sort((a, b) => (a.renew ?? a.price ?? 0) - (b.renew ?? b.price ?? 0));

  return {
    name: label,
    checked: targets.length,
    available,
    forSale,
    takenCount,
    unresolved,
  };
}

/** Authoritative check of exact domains the agent already has in mind. */
export async function checkDomains(
  domains: string[],
  signal?: AbortSignal,
): Promise<Array<{ domain: string; status: string; price?: number; renew?: number }>> {
  const { pricing } = await buildTargets();
  const out: Array<{ domain: string; status: string; price?: number; renew?: number }> = [];

  const valid = domains
    .map((d) => d.trim().toLowerCase().replace(/^\./, ""))
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))
    .slice(0, 20);

  await pooled(
    valid,
    12,
    async (domain) => {
      const tld = domain.split(".").slice(1).join(".");
      const dns = await lookupNs(domain, signal);
      if (dns.verdict === "delegated") {
        const market = detectMarket(domain, dns.ns);
        return { status: market ? `for sale (${market.name})` : "taken" };
      }
      const verdict = await authoritative(domain, tld, signal);
      return { status: verdict?.status ?? "unresolved" };
    },
    (res, domain) => {
      const tld = domain.split(".").slice(1).join(".");
      const price = pricing[tld];
      out.push({
        domain,
        status: res.status,
        price: price?.registration,
        renew: price?.renewal,
      });
    },
    signal,
  );

  return out;
}

/** What namespaces even exist inside the brief's constraints. */
export async function listTlds(filters: SweepFilters & { limit?: number }) {
  const list = await candidates(filters, filters.limit ?? 60);
  return list.map((d) => ({
    tld: d.tld,
    price: d.price,
    renew: d.renew,
    categories: d.categories,
    length: d.length,
  }));
}

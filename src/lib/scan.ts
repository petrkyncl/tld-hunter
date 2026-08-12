import { domainToASCII } from "node:url";
import { classify } from "./categories";
import { lookupNs } from "./dns";
import { detectMarket } from "./parking";
import { pooled } from "./pool";
import { getPricing, type Price } from "./pricing";
import { rdapLookup } from "./rdap";
import { getAllTlds, toUnicode } from "./tlds";
import { whoisLookup } from "./whois";
import type { Confidence, Status, TldResult, Via } from "./types";

export interface NormalizedQuery {
  label: string;
  display: string;
  /** The suffix the user typed explicitly, if any: "kyncl.co.uk" -> "co.uk". */
  suffix?: string;
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Both phases are wide by default and tunable per host via env. */
const DNS_CONCURRENCY = Number(process.env.SCAN_DNS_CONCURRENCY) || 96;
const AUTH_CONCURRENCY = Number(process.env.SCAN_AUTH_CONCURRENCY) || 48;

export function normalizeQuery(raw: string): NormalizedQuery | { error: string } {
  const trimmed = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!trimmed) return { error: "Type the name you want to check." };

  // "neco.com" -> "neco"; supplying the TLD is our job
  const label = trimmed.split(".")[0];
  const ascii = domainToASCII(label);

  if (!ascii) return { error: "That name cannot be converted into a domain." };
  if (ascii.length > 63) return { error: "The name is longer than 63 characters." };
  if (!LABEL_RE.test(ascii)) {
    return { error: "Only letters, digits and hyphens are allowed (not at the edges)." };
  }
  const rest = trimmed.slice(label.length + 1);
  const suffix = rest && /^[a-z0-9.-]+$/.test(rest) ? domainToASCII(rest) || undefined : undefined;

  return { label: ascii, display: label, suffix };
}

export interface ScanOptions {
  /** Suffix the user asked for by name — checked and reported first. */
  focus?: string;
  limit?: number;
  /** Skip phase 2 entirely (DNS-only sweep). */
  verify?: boolean;
  signal?: AbortSignal;
}

export interface ScanEmitter {
  result: (r: TldResult) => void;
  update: (u: { tld: string; status?: Status; confidence?: Confidence; via?: Via }) => void;
  phase: (p: { phase: "verify"; pending: number }) => void;
}

export async function buildTargets(limit?: number, focus?: string) {
  const [tlds, pricing] = await Promise.all([
    getAllTlds(),
    getPricing().catch(() => ({}) as Record<string, Price>),
  ]);
  let list = typeof limit === "number" ? tlds.slice(0, limit) : tlds;

  // whatever the user typed jumps the queue in both phases
  if (focus) {
    const hit = list.find((t) => t.tld === focus);
    if (hit) list = [{ ...hit, rank: -1 }, ...list.filter((t) => t.tld !== focus)];
  }

  return { list, pricing: pricing as Record<string, Price> };
}

/** Static facts about a suffix — no network involved. */
export function describeTld(tld: string, rank: number, price?: Price) {
  const { kind, categories } = classify(tld, price !== undefined);
  const unicode = toUnicode(tld);
  // a few entries in the public price list are 0.00 placeholders, not free domains
  const sellable = price && price.registration > 0 ? price : undefined;

  return {
    tld,
    tldUnicode: unicode,
    rank,
    labels: tld.split(".").length,
    length: unicode.replace(/\./g, "").length,
    kind,
    categories,
    price: sellable?.registration,
    renew: sellable?.renewal,
    transfer: sellable?.transfer,
  };
}

/**
 * Authoritative answer for one domain: RDAP where the registry has it, port-43
 * WHOIS where it does not. Returns null when neither could answer.
 */
export async function authoritative(
  domain: string,
  tld: string,
  signal?: AbortSignal,
): Promise<{ status: Status; via: Via } | null> {
  const rdap = await rdapLookup(domain, tld, { signal });
  if (rdap.verdict === "available") return { status: "free", via: "rdap" };
  if (rdap.verdict === "registered") return { status: "taken", via: "rdap" };

  if (signal?.aborted) return null;

  const whois = await whoisLookup(domain, tld, signal);
  if (whois === "available") return { status: "free", via: "whois" };
  if (whois === "registered") return { status: "taken", via: "whois" };

  return null;
}

/**
 * Phase 1 sweeps every TLD over DNS, which answers in seconds and is proof of
 * registration whenever a delegation exists. Phase 2 then upgrades everything
 * DNS could not settle — names with no delegation may still be registered —
 * against the registries themselves, streaming corrections as they land.
 */
export async function scan(
  label: string,
  opts: ScanOptions,
  emit: ScanEmitter,
): Promise<number> {
  const { list, pricing } = await buildTargets(opts.limit, opts.focus);
  const pending: Array<{ tld: string; domain: string; rank: number }> = [];

  const scanned = await pooled(
    list,
    DNS_CONCURRENCY,
    async ({ tld, rank }): Promise<TldResult> => {
      const domain = `${label}.${tld}`;
      const base: TldResult = {
        ...describeTld(tld, rank, pricing[tld]),
        domain,
        domainUnicode: `${label}.${toUnicode(tld)}`,
        status: "unknown",
        confidence: "likely",
        via: "dns",
      };

      const dns = await lookupNs(domain, opts.signal);

      if (dns.verdict === "delegated") {
        const market = detectMarket(domain, dns.ns);
        return {
          ...base,
          status: market ? "forsale" : "taken",
          confidence: "confirmed",
          ns: dns.ns,
          market,
        };
      }

      return dns.verdict === "nxdomain" ? { ...base, status: "free", confidence: "likely" } : base;
    },
    (result) => {
      emit.result(result);
      if (result.confidence === "likely") {
        pending.push({ tld: result.tld, domain: result.domain, rank: result.rank });
      }
    },
    opts.signal,
  );

  if (opts.verify === false || opts.signal?.aborted || !pending.length) return scanned;

  // most relevant suffixes first, so the top of the list firms up immediately
  pending.sort((a, b) => a.rank - b.rank);
  emit.phase({ phase: "verify", pending: pending.length });

  await pooled(
    pending,
    AUTH_CONCURRENCY,
    ({ domain, tld }) => authoritative(domain, tld, opts.signal),
    (verdict, item) => {
      // always emitted, so the client can track verification progress
      emit.update(
        verdict
          ? {
              tld: item.tld,
              status: verdict.status,
              confidence: "confirmed",
              via: verdict.via === "rdap" ? "dns+rdap" : "dns+whois",
            }
          : { tld: item.tld },
      );
    },
    opts.signal,
  );

  return scanned;
}

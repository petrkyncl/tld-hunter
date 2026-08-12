import { cached, DAY } from "./cache";
import { KeyedSemaphore, sleep } from "./pool";
import { withTimeout } from "./signal";
import { rootOf } from "./tlds";

const BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

/**
 * Registries are aggressive about bulk queries — Identity Digital alone serves
 * ~450 TLDs from one endpoint and answers 403 to *everything* for ten minutes
 * once you burst it, which on a shared server IP would take the tool down for
 * every user. So the pace per endpoint is discovered rather than guessed: start
 * fast, widen the gap sharply the moment a registry pushes back, decay it again
 * while answers keep coming, and park the host entirely if it keeps refusing.
 */
const gate = new KeyedSemaphore(6);
const MIN_GAP_MS = 35;
const MAX_GAP_MS = 3000;
const BREAKER_TRIP = 6;
const BREAKER_COOLDOWN = 10 * 60 * 1000;

const lastCall = new Map<string, number>();
const gapMs = new Map<string, number>();
const strikes = new Map<string, number>();
const parkedUntil = new Map<string, number>();

function currentGap(host: string) {
  return gapMs.get(host) ?? MIN_GAP_MS;
}

function slowDown(host: string) {
  gapMs.set(host, Math.min(MAX_GAP_MS, currentGap(host) * 2 + 150));
}

function speedUp(host: string) {
  const next = currentGap(host) * 0.85;
  if (next <= MIN_GAP_MS) gapMs.delete(host);
  else gapMs.set(host, next);
}

interface Bootstrap {
  services: Array<[string[], string[]]>;
}

/**
 * IANA's bootstrap file lags reality — .io moved to Identity Digital and DENIC
 * has run RDAP for years, neither of which is listed. Overrides win over it.
 */
const RDAP_OVERRIDES: Record<string, string> = {
  io: "https://rdap.identitydigital.services/rdap/",
  sh: "https://rdap.identitydigital.services/rdap/",
  ac: "https://rdap.identitydigital.services/rdap/",
  de: "https://rdap.denic.de/",
  sk: "https://rdap.sk-nic.sk/",
  eu: "https://rdap.eurid.eu/",
  at: "https://rdap.nic.at/",
};

/** tld -> RDAP base URL (always trailing-slash terminated). */
async function getBootstrap(): Promise<Map<string, string>> {
  return cached("rdap:bootstrap", DAY, async () => {
    const res = await fetch(BOOTSTRAP, { cache: "no-store" });
    if (!res.ok) throw new Error(`RDAP bootstrap: HTTP ${res.status}`);
    const json = (await res.json()) as Bootstrap;

    const map = new Map<string, string>();
    for (const [tlds, urls] of json.services) {
      const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
      if (!url) continue;
      const base = url.endsWith("/") ? url : `${url}/`;
      for (const tld of tlds) map.set(tld.toLowerCase(), base);
    }
    return map;
  });
}

export async function rdapBaseFor(tld: string): Promise<string | undefined> {
  const root = rootOf(tld);
  if (RDAP_OVERRIDES[root]) return RDAP_OVERRIDES[root];
  const map = await getBootstrap().catch(() => new Map<string, string>());
  return map.get(root);
}

export type RdapVerdict = "available" | "registered" | "unknown";

export interface RdapResult {
  verdict: RdapVerdict;
  data?: RdapDomain;
}

export interface RdapDomain {
  registrar?: string;
  created?: string;
  expires?: string;
  updated?: string;
  status?: string[];
  ns?: string[];
}

interface RdapPayload {
  ldhName?: string;
  status?: string[];
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  entities?: Array<{ roles?: string[]; vcardArray?: unknown }>;
}

function vcardName(entity: { vcardArray?: unknown }): string | undefined {
  const arr = entity.vcardArray;
  if (!Array.isArray(arr) || arr.length < 2 || !Array.isArray(arr[1])) return undefined;
  for (const field of arr[1] as unknown[]) {
    if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") {
      return field[3];
    }
  }
  return undefined;
}

function parse(payload: RdapPayload): RdapDomain {
  const events = payload.events ?? [];
  const pick = (action: string) => events.find((e) => e.eventAction === action)?.eventDate;

  const registrar = (payload.entities ?? []).find((e) => e.roles?.includes("registrar"));

  return {
    registrar: registrar ? vcardName(registrar) : undefined,
    created: pick("registration"),
    expires: pick("expiration"),
    updated: pick("last changed") ?? pick("last update of RDAP database"),
    status: payload.status,
    ns: (payload.nameservers ?? [])
      .map((n) => n.ldhName?.toLowerCase())
      .filter((n): n is string => Boolean(n)),
  };
}

function trip(host: string) {
  slowDown(host);
  const n = (strikes.get(host) ?? 0) + 1;
  strikes.set(host, n);
  if (n >= BREAKER_TRIP) parkedUntil.set(host, Date.now() + BREAKER_COOLDOWN);
}

/**
 * Authoritative availability check. 404 from a registry's RDAP endpoint is the
 * standard "no such domain" answer, i.e. the name is free to register.
 */
export async function rdapLookup(
  domain: string,
  tld: string,
  opts: { detail?: boolean; signal?: AbortSignal } = {},
): Promise<RdapResult> {
  const base = await rdapBaseFor(tld);
  if (!base) return { verdict: "unknown" };

  const host = new URL(base).host;
  const parked = parkedUntil.get(host);
  if (parked && parked > Date.now()) return { verdict: "unknown" };
  if (parked) {
    parkedUntil.delete(host);
    strikes.delete(host);
  }

  const url = `${base}domain/${encodeURIComponent(domain)}`;

  return gate.run(host, async () => {
    const wait = currentGap(host) - (Date.now() - (lastCall.get(host) ?? 0));
    if (wait > 0) await sleep(wait);

    for (let attempt = 0; attempt < 3; attempt++) {
      lastCall.set(host, Date.now());
      try {
        const res = await fetch(url, {
          headers: { accept: "application/rdap+json, application/json" },
          signal: withTimeout(opts.detail ? 12_000 : 7000, opts.signal),
          redirect: "follow",
          cache: "no-store",
        });

        if (res.status === 404) {
          void res.body?.cancel();
          strikes.delete(host);
          speedUp(host);
          return { verdict: "available" };
        }

        if (res.status === 429 || res.status === 403 || res.status === 503) {
          void res.body?.cancel();
          trip(host);
          if (parkedUntil.has(host)) return { verdict: "unknown" };
          await sleep(500 * (attempt + 1));
          continue;
        }

        if (res.ok) {
          strikes.delete(host);
          speedUp(host);
          if (!opts.detail) {
            void res.body?.cancel();
            return { verdict: "registered" };
          }
          return { verdict: "registered", data: parse((await res.json()) as RdapPayload) };
        }

        void res.body?.cancel();
        return { verdict: "unknown" };
      } catch {
        if (attempt === 2 || opts.signal?.aborted) return { verdict: "unknown" };
        await sleep(300);
      }
    }
    return { verdict: "unknown" };
  });
}

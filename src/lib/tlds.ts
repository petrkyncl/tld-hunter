import { domainToUnicode } from "node:url";
import { cached, DAY } from "./cache";
import { getPricing } from "./pricing";

const IANA_LIST = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";

/**
 * Suffixes people actually reach for first. Scanned before the long tail so the
 * UI fills with useful rows in the first second instead of with .aaa/.abbott.
 */
const PRIORITY = [
  "com", "cz", "net", "org", "io", "sk", "eu", "dev", "app", "ai",
  "co", "me", "info", "biz", "shop", "online", "site", "store", "xyz", "cloud",
  "tech", "digital", "agency", "studio", "design", "media", "systems", "solutions",
  "de", "at", "pl", "hu", "uk", "co.uk", "fr", "it", "es", "nl", "be", "ch",
  "se", "no", "dk", "fi", "pt", "ro", "gr", "ie", "lt", "lv", "ee", "si", "hr",
  "us", "ca", "au", "com.au", "nz", "co.nz", "jp", "cn", "in", "br", "com.br",
  "ru", "ua", "tv", "cc", "gg", "sh", "so", "to", "id", "is", "im", "li", "ly",
  "one", "life", "world", "space", "website", "email", "team", "group", "works",
  "network", "software", "codes", "tools", "expert", "consulting", "company",
  "finance", "capital", "fund", "money", "market", "trade", "business", "center",
  "energy", "health", "care", "fit", "run", "bike", "coffee", "pizza", "bar",
  "art", "photo", "photography", "gallery", "music", "film", "games", "fun",
  "blog", "news", "press", "wiki", "guru", "ninja", "rocks", "cool", "club",
  "pro", "name", "mobi", "link", "click", "live", "today", "zone", "plus",
];

const RANK = new Map(PRIORITY.map((t, i) => [t, i]));

export interface TldInfo {
  tld: string;
  rank: number;
}

/** IANA root zone: every ASCII TLD that exists, IDN ones as xn-- labels. */
async function fetchIanaTlds(): Promise<string[]> {
  const res = await fetch(IANA_LIST, { cache: "no-store" });
  if (!res.ok) throw new Error(`IANA TLD list: HTTP ${res.status}`);
  const text = await res.text();
  return text
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * Full namespace list: every IANA TLD, plus the multi-label public suffixes a
 * registrar actually sells (co.uk, com.au, ...) which are not in the root zone.
 */
export async function getAllTlds(): Promise<TldInfo[]> {
  return cached("tlds:all", DAY, async () => {
    const [iana, pricing] = await Promise.all([
      fetchIanaTlds(),
      getPricing().catch(() => ({}) as Record<string, unknown>),
    ]);

    const root = new Set(iana);
    const set = new Set(iana);

    // Porkbun's list adds the multi-label suffixes we want (co.uk, com.au) but
    // also Handshake names like .api, which do not exist in the DNS root at all.
    // Keeping only suffixes whose last label is in the IANA root drops those.
    for (const key of Object.keys(pricing)) {
      const tld = key.toLowerCase();
      if (root.has(rootOf(tld))) set.add(tld);
    }

    const list = [...set].map((tld) => ({
      tld,
      rank: RANK.get(tld) ?? (tld.includes(".") ? 900 : 1000),
    }));

    // priority first, then alphabetical for a stable long tail
    list.sort((a, b) => a.rank - b.rank || a.tld.localeCompare(b.tld));
    return list.map((t, i) => ({ ...t, rank: t.rank < 900 ? t.rank : 900 + i }));
  });
}

/** "xn--p1ai" -> "рф"; plain ASCII passes through unchanged. */
export function toUnicode(name: string): string {
  if (!name.includes("xn--")) return name;
  try {
    return domainToUnicode(name) || name;
  } catch {
    return name;
  }
}

/** Registry TLD used for RDAP bootstrap lookups: "co.uk" -> "uk". */
export function rootOf(tld: string): string {
  const parts = tld.split(".");
  return parts[parts.length - 1];
}

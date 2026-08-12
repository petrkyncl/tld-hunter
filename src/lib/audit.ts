import { withTimeout } from "./signal";

/**
 * "Can I safely build on this name?" — the honest free answer comes from the
 * Internet Archive: what used to live on the domain, for how long, and whether
 * it was the kind of content that poisons a domain's reputation.
 */

const CDX = "https://web.archive.org/cdx/search/cdx";

export type RiskId = "adult" | "gambling" | "pharma" | "warez" | "scam" | "parked";

export interface RiskFlag {
  id: RiskId;
  label: string;
  detail: string;
  penalty: number;
}

export interface Snapshot {
  year: number;
  timestamp: string;
  url: string;
  title?: string;
}

export interface AuditReport {
  domain: string;
  score: number;
  level: "clean" | "ok" | "warn" | "bad";
  verdict: string;
  snapshots: number;
  firstYear?: number;
  lastYear?: number;
  activeYears: number;
  samples: Snapshot[];
  flags: RiskFlag[];
  certCount?: number;
  checkedAt: string;
}

/** Word-boundary patterns; loose substrings would flag "bet" inside "better". */
const RULES: Array<{ id: RiskId; label: string; penalty: number; re: RegExp }> = [
  {
    id: "adult",
    label: "Previously adult content",
    penalty: 50,
    re: /\b(porn(o|hub|stars?)?|xxx|hardcore sex|escort|camgirls?|sexcam|erotic(a|ke|ky)?|nude (girls|photos)|milf|hentai|onlyfans|seznamka na sex)\b/i,
  },
  {
    id: "gambling",
    label: "Previously gambling / betting",
    penalty: 40,
    re: /\b(online (casino|kasino)|casino bonus|poker (room|online)|sazkov[aá] kancel[aá][rř]|bookmaker|betting (odds|tips)|free spins|slot machines?|automaty zdarma|ruleta online|bookmakers?)\b/i,
  },
  {
    id: "pharma",
    label: "Previously pharma spam",
    penalty: 40,
    re: /\b(viagra|cialis|levitra|kamagra|tramadol|xanax|buy (pills|meds)|online pharmacy|l[eé]k[aá]rna bez p[rř]edpisu)\b/i,
  },
  {
    id: "warez",
    label: "Previously warez / piracy",
    penalty: 30,
    re: /\b(warez|crack(ed)? (software|version)|keygen|torrents?|free download movies|ke sta[zž]en[ií] zdarma film|dvdrip|putlocker)\b/i,
  },
  {
    id: "scam",
    label: "Suspicious content",
    penalty: 25,
    re: /\b(binary options|forex signals|get rich quick|payday loans?|replica watches|essay writing service|rychl[aá] p[uů]jčka bez registru)\b/i,
  },
  {
    id: "parked",
    label: "Only ever parked",
    penalty: 5,
    re: /\b(this domain (is|may be) for sale|buy this domain|parked (free )?courtesy|domain (parking|broker)|tato dom[eé]na je na prodej)\b/i,
  },
];

interface CdxRow {
  timestamp: string;
  original: string;
}

async function cdxHistory(domain: string, signal?: AbortSignal): Promise<CdxRow[]> {
  const url =
    `${CDX}?url=${encodeURIComponent(domain)}&matchType=domain&output=json` +
    `&fl=timestamp,original&filter=statuscode:200&filter=mimetype:text/html` +
    `&collapse=timestamp:6&limit=1500`;

  const res = await fetch(url, { signal: withTimeout(20_000, signal), cache: "no-store" });
  if (!res.ok) throw new Error(`Wayback: HTTP ${res.status}`);

  const rows = (await res.json()) as string[][];
  if (!Array.isArray(rows) || rows.length < 2) return [];
  return rows.slice(1).map(([timestamp, original]) => ({ timestamp, original }));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

async function fetchSnapshot(
  row: CdxRow,
  signal?: AbortSignal,
): Promise<{ snap: Snapshot; text: string } | null> {
  // the "id_" modifier returns the original bytes without the Wayback toolbar
  const url = `https://web.archive.org/web/${row.timestamp}id_/${row.original}`;
  try {
    const res = await fetch(url, {
      signal: withTimeout(15_000, signal),
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) return null;

    const html = (await res.text()).slice(0, 200_000);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim().slice(0, 140);

    return {
      snap: {
        year: Number(row.timestamp.slice(0, 4)),
        timestamp: row.timestamp,
        url: `https://web.archive.org/web/${row.timestamp}/${row.original}`,
        title: title && title.length ? title : undefined,
      },
      text: `${title ?? ""} ${stripHtml(html)}`.slice(0, 120_000),
    };
  } catch {
    return null;
  }
}

/** Best-effort only: crt.sh is frequently down and must never fail the audit. */
async function certCount(domain: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json&exclude=expired`,
      { signal: withTimeout(8000, signal), cache: "no-store" },
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as unknown[];
    return Array.isArray(json) ? json.length : undefined;
  } catch {
    return undefined;
  }
}

/** Spread the sampled snapshots across the whole timeline, not just the newest. */
function pickSamples(rows: CdxRow[], count: number): CdxRow[] {
  if (rows.length <= count) return rows;
  const step = (rows.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => rows[Math.round(i * step)]);
}

export async function auditDomain(
  domain: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AuditReport> {
  const now = new Date();
  const base: AuditReport = {
    domain,
    score: 100,
    level: "clean",
    verdict: "",
    snapshots: 0,
    activeYears: 0,
    samples: [],
    flags: [],
    checkedAt: now.toISOString(),
  };

  let rows: CdxRow[] = [];
  try {
    rows = await cdxHistory(domain, opts.signal);
  } catch {
    return {
      ...base,
      score: 50,
      level: "ok",
      verdict: "History could not be verified — the Internet Archive did not respond.",
    };
  }

  if (!rows.length) {
    return {
      ...base,
      verdict: "No trace in the Internet Archive. This name never had a public site — a clean start.",
    };
  }

  const years = rows.map((r) => Number(r.timestamp.slice(0, 4))).filter(Boolean);
  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const activeYears = new Set(years).size;

  const sampled = pickSamples(rows, 5);
  const fetched = await Promise.all(sampled.map((r) => fetchSnapshot(r, opts.signal)));
  const ok = fetched.filter((x): x is { snap: Snapshot; text: string } => x !== null);
  const corpus = ok.map((x) => x.text).join(" \n ");

  const flags: RiskFlag[] = [];
  for (const rule of RULES) {
    const hit = rule.re.exec(corpus);
    if (!hit) continue;
    flags.push({
      id: rule.id,
      label: rule.label,
      detail: `found in archive: "${hit[0]}"`,
      penalty: rule.penalty,
    });
  }

  let score = 100 - flags.reduce((s, f) => s + f.penalty, 0);

  // a long, ordinary history is an asset; a stale one-off is mildly negative
  const stale = now.getUTCFullYear() - lastYear;
  if (!flags.length) {
    if (activeYears >= 5) score = Math.min(100, score + 0);
    else if (activeYears <= 1 && stale > 5) score -= 10;
  }
  if (stale > 10) score -= 5;

  score = Math.max(0, Math.min(100, score));

  const level: AuditReport["level"] =
    score >= 85 ? "clean" : score >= 65 ? "ok" : score >= 40 ? "warn" : "bad";

  const verdict = flags.length
    ? `The archive shows ${flags.map((f) => f.label.toLowerCase()).join(", ")}. ` +
      `Building here is harder — expect leftover backlinks and a damaged reputation.`
    : `The domain ran a site from ${firstYear} to ${lastYear} (${activeYears} years captured) ` +
      `with nothing problematic in the archive. Safe to build on.`;

  return {
    ...base,
    score,
    level,
    verdict,
    snapshots: rows.length,
    firstYear,
    lastYear,
    activeYears,
    samples: ok.map((x) => x.snap),
    flags,
    certCount: await certCount(domain, opts.signal),
  };
}

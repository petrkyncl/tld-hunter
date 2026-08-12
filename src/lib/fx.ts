import { cached, HOUR } from "./cache";

/**
 * Live FX, no hardcoded rates. Primary source is the ČNB daily fixing (official,
 * free, no key); the ECB-backed Frankfurter API is the fallback. Everything is
 * expressed relative to USD because that is the currency Porkbun prices in.
 */

const CNB =
  "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";
const FRANKFURTER = "https://api.frankfurter.dev/v1/latest";

export const CURRENCIES = ["USD", "CZK", "EUR", "GBP", "PLN"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Rates {
  base: "USD";
  /** how many units of the currency one USD buys */
  rates: Record<string, number>;
  date: string;
  source: string;
}

/** ČNB publishes "how many CZK for <amount> units of <code>" — one row per line. */
async function fromCnb(): Promise<Rates> {
  const res = await fetch(CNB, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ČNB: HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.trim().split("\n");
  const date = lines[0]?.split(" ")[0] ?? "";

  const czkPerUnit: Record<string, number> = { CZK: 1 };
  for (const line of lines.slice(2)) {
    const cols = line.split("|");
    if (cols.length < 5) continue;
    const amount = Number(cols[2]);
    const code = cols[3]?.trim().toUpperCase();
    const rate = Number(cols[4].replace(",", "."));
    if (!code || !Number.isFinite(amount) || !Number.isFinite(rate) || amount === 0) continue;
    czkPerUnit[code] = rate / amount;
  }

  const usdCzk = czkPerUnit.USD;
  if (!usdCzk) throw new Error("CNB: missing USD rate");

  const rates: Record<string, number> = { USD: 1 };
  for (const [code, czk] of Object.entries(czkPerUnit)) {
    if (code === "USD") continue;
    rates[code] = usdCzk / czk;
  }

  return { base: "USD", rates, date, source: "ČNB" };
}

async function fromFrankfurter(): Promise<Rates> {
  const symbols = CURRENCIES.filter((c) => c !== "USD").join(",");
  const res = await fetch(`${FRANKFURTER}?base=USD&symbols=${symbols}`, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Frankfurter: HTTP ${res.status}`);

  const json = (await res.json()) as { date?: string; rates?: Record<string, number> };
  if (!json.rates) throw new Error("Frankfurter: empty response");

  return {
    base: "USD",
    rates: { USD: 1, ...json.rates },
    date: json.date ?? "",
    source: "ECB / Frankfurter",
  };
}

export async function getRates(): Promise<Rates> {
  return cached("fx:usd", 6 * HOUR, async () => {
    try {
      return await fromCnb();
    } catch {
      return await fromFrankfurter();
    }
  });
}

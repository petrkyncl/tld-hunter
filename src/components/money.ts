import type { Currency, Rates } from "@/lib/fx";

/** Porkbun quotes USD; everything else is converted with live rates only. */
export function formatPrice(
  usd: number | undefined,
  currency: Currency,
  rates: Rates | null,
): string | null {
  if (usd === undefined) return null;

  const rate = currency === "USD" ? 1 : rates?.rates[currency];
  if (!rate) return currency === "USD" ? fmt(usd, currency, 2) : null;

  return fmt(usd * rate, currency, currency === "CZK" || currency === "PLN" ? 0 : 2);
}

/** Registrations are billed yearly; the monthly figure is just easier to feel. */
export function formatMonthly(
  usd: number | undefined,
  currency: Currency,
  rates: Rates | null,
): string | null {
  if (usd === undefined) return null;

  const rate = currency === "USD" ? 1 : rates?.rates[currency];
  if (!rate) return null;

  const monthly = (usd * rate) / 12;
  return fmt(monthly, currency, monthly < 10 ? 2 : monthly < 100 ? 1 : 0);
}

function fmt(value: number, currency: Currency, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

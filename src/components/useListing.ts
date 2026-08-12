"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/basePath";
import type { Listing } from "@/lib/market";

/**
 * Asks the marketplace whether a taken domain is actually for sale, and for
 * how much. Runs only when enabled — this is a per-domain lookup against a
 * third party, not something to fire for every row on screen.
 */
export function useListing(domain: string, enabled: boolean) {
  const [result, setResult] = useState<Listing | "error" | null>(null);

  useEffect(() => {
    if (!enabled || !domain) return;
    let alive = true;

    fetch(api(`/api/market?domain=${encodeURIComponent(domain)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lookup failed"))))
      .then((l) => alive && setResult(l as Listing))
      .catch(() => alive && setResult("error"));

    return () => {
      alive = false;
    };
  }, [domain, enabled]);

  return {
    listing: result && result !== "error" ? result : null,
    loading: enabled && result === null,
  };
}

/** "$19,995" / "offers from $9,998" / "make an offer" */
export function askLabel(listing: Listing): string {
  if (listing.priceUsd) return `$${listing.priceUsd.toLocaleString("en-US")}`;
  if (listing.minOfferUsd) return `offers from $${listing.minOfferUsd.toLocaleString("en-US")}`;
  return "make an offer";
}

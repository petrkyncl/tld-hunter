"use client";

import { memo } from "react";
import { formatMonthly, formatPrice } from "./money";
import type { Currency, Rates } from "@/lib/fx";
import type { TldResult } from "@/lib/types";

const TONE: Record<TldResult["status"], string> = {
  pending: "border-edge bg-panel text-muted",
  free: "border-free/40 bg-free/10 text-free",
  forsale: "border-sale/40 bg-sale/10 text-sale",
  taken: "border-taken/40 bg-taken/10 text-taken",
  unknown: "border-unknown/40 bg-unknown/10 text-unknown",
};

const LABEL: Record<TldResult["status"], string> = {
  pending: "…",
  free: "Available",
  forsale: "For sale",
  taken: "Taken",
  unknown: "Unknown",
};

/**
 * Fixed column widths on purpose: the status badge and the pending "?" marker
 * each own their own track, so no row ever shifts sideways as verdicts land.
 */
function DomainRow({
  r,
  currency,
  rates,
  ask,
  onOpen,
}: {
  r: TldResult;
  currency: Currency;
  rates: Rates | null;
  /** Aftermarket asking price, once looked up. */
  ask?: string;
  onOpen: (r: TldResult) => void;
}) {
  const first = formatPrice(r.price, currency, rates);
  const renewal = formatPrice(r.renew, currency, rates);
  // the monthly figure that matters long-term is the renewal, not the teaser year
  const monthly = formatMonthly(r.renew ?? r.price, currency, rates);
  const pending = r.status === "pending";

  return (
    <li className="border-b border-edge-soft last:border-0">
      <button
        onClick={() => !pending && onOpen(r)}
        disabled={pending}
        className={`grid w-full grid-cols-[5.5rem_0.75rem_1fr_auto] items-center gap-x-3 px-3 py-2 text-left transition sm:grid-cols-[6rem_0.75rem_1fr_8.5rem_4.5rem] sm:px-4 ${
          pending ? "cursor-default" : "cursor-pointer hover:bg-panel-2/70"
        }`}
      >
        <span
          className={`rounded-md border px-1 py-0.5 text-center text-[11px] font-medium ${TONE[r.status]} ${
            pending ? "animate-pulse" : ""
          }`}
        >
          {LABEL[r.status]}
        </span>

        <span
          className="text-center font-mono text-[11px] text-muted"
          title={
            r.confidence === "likely" && !pending
              ? "DNS-based guess — registry verification still running"
              : undefined
          }
        >
          {r.confidence === "likely" && !pending && r.status !== "unknown" ? "?" : ""}
        </span>

        <span className="min-w-0 truncate font-mono text-[15px]">
          <span className="text-muted">{r.domainUnicode.split(".")[0]}</span>
          <span className="text-fg">.{r.tldUnicode}</span>
          {r.market && (
            <span className="ml-2 hidden rounded bg-sale/10 px-1.5 py-0.5 text-[10px] text-sale sm:inline">
              {r.market.name}
            </span>
          )}
        </span>

        <span className="hidden text-right font-mono leading-tight sm:block">
          {ask ? (
            <>
              <span className="text-sale">{ask}</span>
              <span className="block text-[10px] text-muted">aftermarket</span>
            </>
          ) : first ? (
            <>
              <span className={r.status === "free" ? "text-fg" : "text-muted"}>{first}</span>
              <span className="block text-[10px] text-muted">
                {renewal ? `then ${renewal}/yr` : "first year"}
              </span>
              {monthly && <span className="block text-[10px] text-muted">{monthly}/mo</span>}
            </>
          ) : (
            <span className="text-[11px] text-muted">—</span>
          )}
        </span>

        <span className="justify-self-end">
          {r.status === "free" && (
            <span className="rounded-md border border-free/40 bg-free/10 px-2 py-1 text-[11px] font-medium text-free">
              Buy
            </span>
          )}
          {r.status === "forsale" && (
            <span className="rounded-md border border-sale/40 bg-sale/10 px-2 py-1 text-[11px] font-medium text-sale">
              Offer
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export default memo(DomainRow);

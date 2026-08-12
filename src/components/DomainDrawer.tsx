"use client";

import { useEffect, useState } from "react";
import AuditPanel from "./AuditPanel";
import { formatMonthly, formatPrice } from "./money";
import { askLabel, useListing } from "./useListing";
import { KIND_LABEL } from "@/lib/categories";
import { api } from "@/lib/basePath";
import type { Currency, Rates } from "@/lib/fx";
import type { TldResult } from "@/lib/types";

const STATUS_META = {
  pending: { label: "Checking…", cls: "text-muted border-edge bg-panel" },
  free: { label: "Available", cls: "text-free border-free/40 bg-free/10" },
  forsale: { label: "For sale", cls: "text-sale border-sale/40 bg-sale/10" },
  taken: { label: "Taken", cls: "text-taken border-taken/40 bg-taken/10" },
  unknown: { label: "Unknown", cls: "text-unknown border-unknown/40 bg-unknown/10" },
} as const;

interface Detail {
  verdict: string;
  whois?: {
    registrar?: string;
    created?: string;
    expires?: string;
    status?: string[];
    ns?: string[];
  };
  check?: { available?: boolean; premium?: boolean; price?: number; regularPrice?: number };
  aftermarket?: Array<{ name: string; url: string }>;
}

function fmtDate(iso?: string) {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB");
}

export default function DomainDrawer({
  r,
  currency,
  rates,
  onClose,
}: {
  r: TldResult;
  currency: Currency;
  rates: Rates | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  // the parent keys this component by domain, so each open mounts fresh
  useEffect(() => {
    let alive = true;

    fetch(api(`/api/detail?domain=${encodeURIComponent(r.domain)}&tld=${encodeURIComponent(r.tld)}`))
      .then((res) => res.json())
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail({ verdict: "unknown" }))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [r.domain, r.tld]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { listing, loading: askLoading } = useListing(
    r.domain,
    r.status === "taken" || r.status === "forsale",
  );

  const meta = STATUS_META[r.status];
  const price = formatPrice(r.price, currency, rates);
  const renew = formatPrice(r.renew, currency, rates);
  const monthly = formatMonthly(r.renew ?? r.price, currency, rates);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="scroll-slim max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-edge bg-panel p-4 shadow-2xl sm:rounded-2xl sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-xl">
              <span className="text-muted">{r.domainUnicode.split(".")[0]}</span>
              <span className="text-fg">.{r.tldUnicode}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                {meta.label}
                {r.confidence === "likely" && r.status !== "unknown" ? " ?" : ""}
              </span>
              <span className="text-xs text-muted">{KIND_LABEL[r.kind]}</span>
              {price && (
                <span className="font-mono text-sm">
                  {price} <span className="text-xs text-muted">first year</span>
                  {renew && (
                    <span className="text-xs text-muted">
                      {" · "}
                      {renew}/yr after
                    </span>
                  )}
                  {monthly && <span className="text-xs text-muted">{` · ${monthly}/mo`}</span>}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="shrink-0 rounded-md border border-edge px-2 py-1 text-xs text-muted transition hover:text-fg"
          >
            Esc
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {r.status === "free" && (
            <a
              href={`https://porkbun.com/checkout/search?q=${encodeURIComponent(r.domain)}`}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-free/40 bg-free/10 px-3 py-1.5 text-xs font-medium text-free transition hover:bg-free/20"
            >
              Register at Porkbun ↗
            </a>
          )}
          {listing?.listed && (
            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-sale/40 bg-sale/10 px-3 py-1.5 text-xs font-medium text-sale transition hover:bg-sale/20"
            >
              For sale · {askLabel(listing)} ↗
            </a>
          )}
          {askLoading && (
            <span className="rounded-md border border-edge px-3 py-1.5 text-xs text-muted">
              Checking aftermarket…
            </span>
          )}
          {r.market && !listing?.listed && (
            <a
              href={r.market.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-sale/40 bg-sale/10 px-3 py-1.5 text-xs font-medium text-sale transition hover:bg-sale/20"
            >
              {r.market.name} listing ↗
            </a>
          )}
          <a
            href={`https://${r.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-xs transition hover:border-brand/50"
          >
            Open site ↗
          </a>
          {detail?.aftermarket?.map((m) => (
            <a
              key={m.name}
              href={m.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-xs transition hover:border-brand/50"
            >
              {m.name} ↗
            </a>
          ))}
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <dl className="space-y-1">
            <Field k="Levels / length" v={`${r.labels} · ${r.length} chars`} />
            <Field k="Verified via" v={r.via} />
            {loading && <p className="text-xs text-muted">Loading registry data…</p>}
            {detail?.whois?.registrar && <Field k="Registrar" v={detail.whois.registrar} />}
            {detail?.whois?.created && <Field k="Registered" v={fmtDate(detail.whois.created)!} />}
            {detail?.whois?.expires && <Field k="Expires" v={fmtDate(detail.whois.expires)!} />}
            {detail?.whois?.status?.length ? (
              <Field k="Registry status" v={detail.whois.status.join(", ")} />
            ) : null}
            {r.ns?.length ? <Field k="Nameservers" v={r.ns.join(", ")} /> : null}
            {detail?.check?.premium && (
              <Field
                k="Premium price"
                v={`$${detail.check.price?.toFixed(2)} (standard $${detail.check.regularPrice?.toFixed(2)})`}
              />
            )}
            {!loading && !detail?.whois && detail?.verdict === "available" && (
              <p className="pt-1 text-xs text-free">
                The registry confirms this domain is available.
              </p>
            )}
            {!loading && !detail?.whois && detail?.verdict === "unknown" && (
              <p className="pt-1 text-xs text-muted">
                This registry publishes no RDAP record for the name.
              </p>
            )}
          </dl>

          <div className="rounded-lg border border-edge bg-ink/40 p-3">
            <AuditPanel domain={r.domain} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-xs text-muted">{k}</dt>
      <dd className="min-w-0 break-words font-mono text-xs">{v}</dd>
    </div>
  );
}

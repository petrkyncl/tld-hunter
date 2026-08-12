"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DomainDrawer from "./DomainDrawer";
import DomainRow from "./DomainRow";
import { formatPrice } from "./money";
import { CATEGORIES, KIND_LABEL, type CategoryId, type TldKind } from "@/lib/categories";
import { CURRENCIES, type Currency, type Rates } from "@/lib/fx";
import type { ScanMessage, ScanUpdateMsg, Status, TldResult } from "@/lib/types";

type Filter = "all" | "free" | "forsale" | "taken";
type Sort = "smart" | "price-asc" | "price-desc" | "alpha" | "length";
type Levels = "all" | "1" | "2";

/** Everything the catalogue knows about a suffix before any lookup happens. */
type Catalog = Omit<
  TldResult,
  "domain" | "domainUnicode" | "status" | "confidence" | "via" | "ns" | "market"
>;

const FILTERS: Array<{ id: Filter; label: string; dot: string }> = [
  { id: "all", label: "All", dot: "bg-muted" },
  { id: "free", label: "Available", dot: "bg-free" },
  { id: "forsale", label: "For sale", dot: "bg-sale" },
  { id: "taken", label: "Taken", dot: "bg-taken" },
];

const KINDS: TldKind[] = ["generic", "country", "geo", "idn", "multi", "brand"];
const STATUS_ORDER: Record<Status, number> = {
  free: 0,
  forsale: 1,
  pending: 2,
  unknown: 3,
  taken: 4,
};
const MAX_LEN = 24;
const PAGE = 400;

export default function DomainSearch() {
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [running, setRunning] = useState(false);

  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [scanMap, setScanMap] = useState<Map<string, TldResult>>(new Map());

  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyPending, setVerifyPending] = useState(0);
  const [verifyDone, setVerifyDone] = useState(0);
  const [selected, setSelected] = useState<TldResult | null>(null);
  const [shown, setShown] = useState(PAGE);

  const [rates, setRates] = useState<Rates | null>(null);
  const [currency, setCurrency] = useState<Currency>("CZK");

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("smart");
  const [needle, setNeedle] = useState("");
  const [pricedOnly, setPricedOnly] = useState(true);
  const [levels, setLevels] = useState<Levels>("1");
  const [maxLen, setMaxLen] = useState(MAX_LEN);
  const [kind, setKind] = useState<TldKind | "all">("all");
  const [cats, setCats] = useState<CategoryId[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef<TldResult[]>([]);
  const updateRef = useRef<ScanUpdateMsg[]>([]);
  const flushRef = useRef<number | null>(null);

  // catalogue and FX load in parallel on mount, so the grid is populated before
  // the user has typed anything at all
  useEffect(() => {
    fetch("/api/tlds")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.tlds && setCatalog(d.tlds as Catalog[]))
      .catch(() => setError("Could not load the TLD catalogue."));

    fetch("/api/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && !r.error && setRates(r as Rates))
      .catch(() => setCurrency("USD"));
  }, []);

  const flush = useCallback(() => {
    const batch = bufferRef.current;
    const updates = updateRef.current;
    if (!batch.length && !updates.length) return;
    bufferRef.current = [];
    updateRef.current = [];

    setScanMap((prev) => {
      const next = new Map(prev);
      for (const r of batch) next.set(r.tld, r);
      for (const u of updates) {
        if (!u.status) continue;
        const cur = next.get(u.tld);
        if (!cur) continue;
        next.set(u.tld, {
          ...cur,
          status: u.status,
          confidence: u.confidence ?? "confirmed",
          via: u.via ?? cur.via,
        });
      }
      return next;
    });

    if (updates.length) setVerifyDone((d) => d + updates.length);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (flushRef.current) window.clearInterval(flushRef.current);
    };
  }, []);

  const start = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    bufferRef.current = [];
    updateRef.current = [];
    setScanMap(new Map());
    setVerifyPending(0);
    setVerifyDone(0);
    setError(null);
    setElapsed(null);
    setRunning(true);
    setLabel(q.split(".")[0].toLowerCase());

    if (flushRef.current) window.clearInterval(flushRef.current);
    flushRef.current = window.setInterval(flush, 120);

    try {
      const res = await fetch(`/api/scan?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: "Scan failed." }));
        throw new Error(body.error ?? "Scan failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as ScanMessage;
          if (msg.type === "result") bufferRef.current.push(msg);
          else if (msg.type === "update") updateRef.current.push(msg);
          else if (msg.type === "phase") setVerifyPending(msg.pending);
          else if (msg.type === "done") setElapsed(msg.ms);
          else if (msg.type === "error") setError(msg.message);
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      if (flushRef.current) window.clearInterval(flushRef.current);
      flushRef.current = null;
      flush();
      setRunning(false);
    }
  }, [query, flush]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  /** The catalogue, overlaid with whatever the scan has learned so far. */
  const rows = useMemo<TldResult[]>(() => {
    return catalog.map((c) => {
      const hit = scanMap.get(c.tld);
      if (hit) return hit;
      return {
        ...c,
        domain: label ? `${label}.${c.tld}` : c.tld,
        // before a search there is no second-level label to show, just the suffix
        domainUnicode: label ? `${label}.${c.tldUnicode}` : `.${c.tldUnicode}`,
        status: "pending",
        confidence: "likely",
        via: "dns",
      };
    });
  }, [catalog, scanMap, label]);

  const counts = useMemo(() => {
    const c = { all: rows.length, free: 0, forsale: 0, taken: 0, unknown: 0, pending: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const n = needle.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (pricedOnly && r.price === undefined) return false;
      if (levels === "1" && r.labels !== 1) return false;
      if (levels === "2" && r.labels < 2) return false;
      if (r.length > maxLen) return false;
      if (kind !== "all" && r.kind !== kind) return false;
      if (cats.length && !cats.some((c) => r.categories.includes(c))) return false;
      if (n && !r.tld.includes(n) && !r.tldUnicode.includes(n)) return false;
      return true;
    });

    return list.sort((a, b) => {
      switch (sort) {
        case "price-asc":
          return (a.price ?? Infinity) - (b.price ?? Infinity) || a.rank - b.rank;
        case "price-desc":
          return (b.price ?? -Infinity) - (a.price ?? -Infinity) || a.rank - b.rank;
        case "alpha":
          return a.tld.localeCompare(b.tld);
        case "length":
          return a.length - b.length || a.rank - b.rank;
        default:
          return (
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            a.rank - b.rank ||
            a.tld.localeCompare(b.tld)
          );
      }
    });
  }, [rows, filter, sort, needle, pricedOnly, levels, maxLen, kind, cats]);

  const cheapestFree = useMemo(() => {
    let best: TldResult | undefined;
    for (const r of visible) {
      if (r.status !== "free" || r.price === undefined) continue;
      if (!best || r.price < best.price!) best = r;
    }
    return best;
  }, [visible]);

  const exportCsv = useCallback(() => {
    const head = "domain;status;confidence;price_usd;renew_usd;kind;categories;marketplace\n";
    const body = visible
      .map((r) =>
        [
          r.domain,
          r.status,
          r.confidence,
          r.price?.toFixed(2) ?? "",
          r.renew?.toFixed(2) ?? "",
          r.kind,
          r.categories.join("|"),
          r.market?.name ?? "",
        ].join(";"),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([head + body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${label || "domains"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [visible, label]);

  const swept = counts.all - counts.pending;
  const pct = counts.all ? Math.round((swept / counts.all) * 100) : 0;
  const verifyPct = verifyPending ? Math.round((verifyDone / verifyPending) * 100) : 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          TLD <span className="text-brand">Hunter</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One name against <strong className="text-fg">every TLD on earth</strong>. Rows turn green
          when the name is free, blue when it is listed on the aftermarket, red when it is taken.
          Click any row for registry data and a history audit.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
        className="sticky top-0 z-30 rounded-2xl border border-edge bg-panel/90 p-3 backdrop-blur sm:p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 items-center rounded-xl border border-edge bg-ink px-4 focus-within:border-brand/60">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="something"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent py-3 font-mono text-lg outline-none placeholder:text-muted/50"
            />
            <span className="shrink-0 font-mono text-lg text-muted">.*</span>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={running || !query.trim()}
              className="flex-1 rounded-xl bg-brand px-6 py-3 font-medium text-ink transition hover:brightness-110 disabled:opacity-40 sm:flex-none"
            >
              {running ? "Scanning…" : "Search"}
            </button>
            {running && (
              <button
                type="button"
                onClick={stop}
                className="rounded-xl border border-edge px-4 py-3 text-sm text-muted transition hover:text-fg"
              >
                Stop
              </button>
            )}
          </div>
        </div>

        {(running || swept > 0) && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-edge-soft">
              <div
                className={`h-full rounded-full bg-brand transition-[width] duration-200 ${running ? "barber" : ""}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[11px] text-muted">
              {swept}/{counts.all}
              {verifyPending > 0 &&
                ` · registry ${Math.min(verifyDone, verifyPending)}/${verifyPending} (${verifyPct}%)`}
              {elapsed !== null && ` · ${(elapsed / 1000).toFixed(1)}s`}
            </span>
          </div>
        )}
      </form>

      {error && (
        <p className="mt-4 rounded-xl border border-taken/40 bg-taken/10 px-4 py-3 text-sm text-taken">
          {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Available" value={counts.free} tone="text-free" />
        <Stat label="For sale" value={counts.forsale} tone="text-sale" />
        <Stat label="Taken" value={counts.taken} tone="text-taken" />
        <Stat
          label="Cheapest in view"
          value={formatPrice(cheapestFree?.price, currency, rates) ?? "—"}
          hint={cheapestFree ? `.${cheapestFree.tldUnicode}` : undefined}
          tone="text-fg"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => { setFilter(f.id); setShown(PAGE); }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
              filter === f.id
                ? "border-brand/60 bg-brand/10 text-fg"
                : "border-edge bg-panel text-muted hover:text-fg"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />
            {f.label}
            <span className="font-mono text-xs opacity-60">
              {f.id === "all" ? counts.all : counts[f.id]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3 rounded-xl border border-edge bg-panel/50 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Control label="Levels">
            <select
              value={levels}
              onChange={(e) => { setLevels(e.target.value as Levels); setShown(PAGE); }}
              className="rounded-md border border-edge bg-panel px-2 py-1 outline-none focus:border-brand/60"
            >
              <option value="1">single-level only (.com)</option>
              <option value="2">multi-level only (.co.uk)</option>
              <option value="all">all</option>
            </select>
          </Control>

          <Control label={`Max length: ${maxLen === MAX_LEN ? "∞" : maxLen}`}>
            <input
              type="range"
              min={2}
              max={MAX_LEN}
              value={maxLen}
              onChange={(e) => { setMaxLen(Number(e.target.value)); setShown(PAGE); }}
              className="w-28 accent-brand"
            />
          </Control>

          <Control label="Type">
            <select
              value={kind}
              onChange={(e) => { setKind(e.target.value as TldKind | "all"); setShown(PAGE); }}
              className="rounded-md border border-edge bg-panel px-2 py-1 outline-none focus:border-brand/60"
            >
              <option value="all">all</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Control>

          <Control label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="rounded-md border border-edge bg-panel px-2 py-1 outline-none focus:border-brand/60"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c} disabled={c !== "USD" && !rates?.rates[c]}>
                  {c}
                </option>
              ))}
            </select>
          </Control>

          <Control label="Sort">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-md border border-edge bg-panel px-2 py-1 outline-none focus:border-brand/60"
            >
              <option value="smart">recommended</option>
              <option value="price-asc">price ↑</option>
              <option value="price-desc">price ↓</option>
              <option value="length">TLD length</option>
              <option value="alpha">alphabetical</option>
            </select>
          </Control>

          <input
            value={needle}
            onChange={(e) => { setNeedle(e.target.value); setShown(PAGE); }}
            placeholder="filter TLD…"
            className="w-24 rounded-md border border-edge bg-panel px-2 py-1 font-mono outline-none focus:border-brand/60"
          />

          <label className="flex cursor-pointer items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={pricedOnly}
              onChange={(e) => { setPricedOnly(e.target.checked); setShown(PAGE); }}
              className="accent-brand"
            />
            sellable only
          </label>

          <button
            onClick={exportCsv}
            disabled={!visible.length}
            className="ml-auto rounded-md border border-edge bg-panel px-2.5 py-1 text-muted transition hover:text-fg disabled:opacity-40"
          >
            CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted">Categories:</span>
          {CATEGORIES.map((c) => {
            const on = cats.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => {
                  setCats((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]));
                  setShown(PAGE);
                }}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                  on
                    ? "border-brand/60 bg-brand/15 text-fg"
                    : "border-edge bg-panel text-muted hover:text-fg"
                }`}
              >
                {c.label}
              </button>
            );
          })}
          {cats.length > 0 && (
            <button
              onClick={() => { setCats([]); setShown(PAGE); }}
              className="ml-1 text-[11px] text-muted underline hover:text-fg"
            >
              clear
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-right font-mono text-[11px] text-muted">
        showing {Math.min(shown, visible.length)} of {visible.length}
      </p>

      {catalog.length === 0 ? (
        <ul className="mt-1 overflow-hidden rounded-2xl border border-edge bg-panel/60">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="border-b border-edge-soft px-4 py-2 last:border-0">
              <div className="h-6 animate-pulse rounded bg-edge/60" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className="scroll-slim mt-1 max-h-[65vh] overflow-y-auto rounded-2xl border border-edge bg-panel/60">
            {visible.slice(0, shown).map((r) => (
              <DomainRow key={r.tld} r={r} currency={currency} rates={rates} onOpen={setSelected} />
            ))}
            {!visible.length && (
              <li className="px-4 py-10 text-center text-sm text-muted">
                No TLD matches these filters.
              </li>
            )}
          </ul>

          {visible.length > shown && (
            <button
              onClick={() => setShown((s) => s + PAGE)}
              className="mx-auto mt-4 block rounded-lg border border-edge bg-panel px-4 py-2 text-sm text-muted transition hover:text-fg"
            >
              Show {Math.min(PAGE, visible.length - shown)} more
            </button>
          )}
        </>
      )}

      {selected && (
        <DomainDrawer
          key={selected.tld}
          r={scanMap.get(selected.tld) ?? selected}
          currency={currency}
          rates={rates}
          onClose={() => setSelected(null)}
        />
      )}

      <footer className="mt-10 space-y-1 text-xs text-muted">
        <p>
          Status: a DNS sweep answers in seconds, then every unsettled name is verified against the
          registry itself (RDAP, falling back to port-43 WHOIS). A &ldquo;?&rdquo; marks rows still
          waiting on that second pass. TLD list from IANA.
        </p>
        <p>
          Prices: Porkbun&rsquo;s public USD price list (the only registrar publishing one without
          an API key) — other registrars differ, so treat it as a ballpark. Converted with live
          rates{rates ? ` (${rates.source}, ${rates.date})` : ""}, never hardcoded ones.
        </p>
        <p>Domain history: Internet Archive + Certificate Transparency (crt.sh).</p>
      </footer>
    </main>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-muted">
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-panel/70 px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`font-mono text-lg ${tone}`}>
        {value}
        {hint && <span className="ml-1 text-xs text-muted">{hint}</span>}
      </p>
    </div>
  );
}

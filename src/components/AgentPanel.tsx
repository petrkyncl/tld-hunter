"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { formatPrice } from "./money";
import { api } from "@/lib/basePath";
import { CATEGORIES, type CategoryId } from "@/lib/categories";
import type { Currency, Rates } from "@/lib/fx";
import type { AgentEvent, Depth, Usage } from "@/lib/agent/run";
import type { Candidate } from "@/lib/agent/tools";

type LogItem =
  | { kind: "thinking" | "text"; text: string }
  | { kind: "tool"; tool: string; detail: string };

const DEPTHS: Array<{ id: Depth; label: string; note: string }> = [
  { id: "quick", label: "Quick", note: "~$0.10 · under a minute" },
  { id: "normal", label: "Normal", note: "~$0.35 · a few minutes" },
  { id: "deep", label: "Deep", note: "~$0.80 · up to ten minutes" },
];

const CODE_KEY = "tldhunter.agentCode";

const TOOL_LABEL: Record<string, string> = {
  sweep_name: "Sweeping",
  check_domains: "Checking",
  list_tlds: "Reading price list",
  audit_domain: "Auditing history",
  save_candidate: "Shortlisted",
};

export default function AgentPanel({
  currency,
  rates,
}: {
  currency: Currency;
  rates: Rates | null;
}) {
  const [useCase, setUseCase] = useState("");
  const [capPrice, setCapPrice] = useState(false);
  const [maxPrice, setMaxPrice] = useState(40);
  const [cats, setCats] = useState<CategoryId[]>([]);
  const [seeds, setSeeds] = useState("");
  const [depth, setDepth] = useState<Depth>("normal");

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const [shortlist, setShortlist] = useState<Candidate[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [progress, setProgress] = useState({ iteration: 0, max: 0 });
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(true);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<LogItem[]>([]);
  const flushRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (flushRef.current) window.clearInterval(flushRef.current);
    };
  }, []);

  /** Deltas arrive token by token — coalesce them into the trailing entry. */
  const push = useCallback((item: LogItem) => {
    const buf = logRef.current;
    const last = buf[buf.length - 1];
    if (item.kind !== "tool" && last && last.kind === item.kind) {
      buf[buf.length - 1] = { kind: item.kind, text: last.text + item.text };
    } else {
      buf.push(item);
    }
  }, []);

  const start = useCallback(async () => {
    if (useCase.trim().length < 10) {
      setError("Describe what you are building — a sentence or two is enough.");
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    logRef.current = [];
    setLog([]);
    setShortlist([]);
    setUsage(null);
    setProgress({ iteration: 0, max: 0 });
    setError(null);
    setFinished(null);
    setRunning(true);

    if (flushRef.current) window.clearInterval(flushRef.current);
    flushRef.current = window.setInterval(() => setLog([...logRef.current]), 140);

    try {
      const stored = code || window.localStorage.getItem(CODE_KEY) || "";

      const res = await fetch(api("/api/agent"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-code": stored },
        signal: ctrl.signal,
        body: JSON.stringify({
          useCase: useCase.trim(),
          maxPriceUsd: capPrice ? maxPrice : undefined,
          categories: cats,
          seedNames: seeds
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          depth,
        }),
      });

      if (res.status === 401) {
        setNeedsCode(true);
        window.localStorage.removeItem(CODE_KEY);
        throw new Error("This deployment needs an access code before it will spend anything.");
      }

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: "Agent failed to start." }));
        throw new Error(body.error ?? "Agent failed to start.");
      }

      // The code worked — remember it so this is a once-per-browser question.
      if (stored) window.localStorage.setItem(CODE_KEY, stored);
      setNeedsCode(false);

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
          const e = JSON.parse(line) as AgentEvent;
          if (e.type === "thinking") push({ kind: "thinking", text: e.text });
          else if (e.type === "text") push({ kind: "text", text: e.text });
          else if (e.type === "tool") push({ kind: "tool", tool: e.tool, detail: e.detail });
          else if (e.type === "candidate") {
            setShortlist((prev) =>
              prev.some((c) => c.domain === e.candidate.domain)
                ? prev
                : [...prev, e.candidate].sort((a, b) => b.score - a.score),
            );
          } else if (e.type === "usage") {
            setUsage(e.usage);
            setProgress({ iteration: e.iteration, max: e.maxIterations });
          } else if (e.type === "done") setFinished(e.reason);
          else if (e.type === "error") setError(e.message);
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Agent failed.");
    } finally {
      if (flushRef.current) window.clearInterval(flushRef.current);
      flushRef.current = null;
      setLog([...logRef.current]);
      setRunning(false);
    }
  }, [useCase, capPrice, maxPrice, cats, seeds, depth, code, push]);

  useEffect(() => {
    if (running) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, running]);

  const budgetLabel = formatPrice(maxPrice, currency, rates) ?? `$${maxPrice}`;

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-edge bg-panel/70 p-4">
          <h2 className="text-sm font-medium">Tell the agent what you are building</h2>
          <p className="mt-1 text-xs text-muted">
            The more it knows about the product, the audience, and what you have already
            considered, the better its ideas. Say what you think about price here too — a
            sentence in your own words works better than a slider. It checks every name
            against real registries before shortlisting it.
          </p>

          <textarea
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            rows={5}
            placeholder={
              "A booking tool for small physiotherapy clinics in Czechia. Calm, trustworthy, not techy. I liked 'fyzio' names but they all feel taken. Czech or neutral-European reads better than American startup-speak.\n\nOn price: I'd rather pay for something that lasts than optimise for cheap — anything under about $60 a year is fine, and I'd stretch further for the right .com."
            }
            className="mt-3 w-full rounded-xl border border-edge bg-ink p-3 text-sm leading-relaxed outline-none placeholder:text-muted/40 focus:border-brand/60"
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={capPrice}
                onChange={(e) => setCapPrice(e.target.checked)}
                className="accent-brand"
              />
              hard price cap
            </label>

            {capPrice ? (
              <label className="flex items-center gap-2 text-muted">
                <span className="whitespace-nowrap">Never above {budgetLabel}/yr</span>
                <input
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="w-32 accent-brand"
                />
              </label>
            ) : (
              <span className="text-muted/70">
                no ceiling — the agent judges price from what you wrote
              </span>
            )}

            <label className="flex flex-1 items-center gap-2 text-muted">
              <span className="whitespace-nowrap">Your own ideas</span>
              <input
                value={seeds}
                onChange={(e) => setSeeds(e.target.value)}
                placeholder="optional, comma separated"
                className="min-w-0 flex-1 rounded-md border border-edge bg-panel px-2 py-1 font-mono outline-none focus:border-brand/60"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-muted">Lean towards:</span>
            {CATEGORIES.map((c) => {
              const on = cats.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setCats((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                  }
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
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {DEPTHS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDepth(d.id)}
                className={`rounded-lg border px-3 py-1.5 text-left text-xs transition ${
                  depth === d.id
                    ? "border-brand/60 bg-brand/10 text-fg"
                    : "border-edge bg-panel text-muted hover:text-fg"
                }`}
              >
                <span className="block font-medium">{d.label}</span>
                <span className="block text-[10px] opacity-70">{d.note}</span>
              </button>
            ))}

            {needsCode && (
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                type="password"
                placeholder="access code"
                className="w-36 rounded-lg border border-sale/50 bg-panel px-3 py-1.5 font-mono text-xs outline-none focus:border-brand/60"
              />
            )}

            <div className="ml-auto flex gap-2">
              {running && (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="rounded-xl border border-edge px-4 py-2 text-sm text-muted transition hover:text-fg"
                >
                  Stop
                </button>
              )}
              <button
                onClick={start}
                disabled={running}
                className="rounded-xl bg-brand px-5 py-2 text-sm font-medium text-ink transition hover:brightness-110 disabled:opacity-40"
              >
                {running ? "Hunting…" : "Start hunting"}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <p className="rounded-xl border border-taken/40 bg-taken/10 px-4 py-3 text-sm text-taken">
            {error}
          </p>
        )}

        {(log.length > 0 || running) && (
          <section className="rounded-2xl border border-edge bg-panel/50">
            <div className="flex items-center justify-between border-b border-edge-soft px-4 py-2">
              <span className="text-xs text-muted">
                {finished ? `Done — ${finished}` : `Step ${progress.iteration}/${progress.max || "…"}`}
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={showThinking}
                  onChange={(e) => setShowThinking(e.target.checked)}
                  className="accent-brand"
                />
                show reasoning
              </label>
            </div>

            <div className="scroll-slim max-h-[52vh] space-y-2 overflow-y-auto p-4">
              {log.map((item, i) =>
                item.kind === "tool" ? (
                  <p key={i} className="font-mono text-[11px] text-brand">
                    → {TOOL_LABEL[item.tool] ?? item.tool}
                    {item.detail ? `: ${item.detail}` : ""}
                  </p>
                ) : item.kind === "thinking" ? (
                  showThinking && (
                    <Markdown
                      key={i}
                      text={item.text}
                      className="border-l-2 border-edge pl-3 text-xs text-muted"
                    />
                  )
                ) : (
                  <Markdown key={i} text={item.text} className="text-sm leading-relaxed" />
                ),
              )}
              <div ref={bottomRef} />
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-edge bg-panel/70 p-4">
          <h2 className="text-sm font-medium">
            Shortlist{" "}
            <span className="font-mono text-xs text-muted">{shortlist.length}</span>
          </h2>

          {!shortlist.length && (
            <p className="mt-2 text-xs text-muted">
              Verified finds appear here as the agent works — you do not have to wait for it
              to finish.
            </p>
          )}

          <ul className="mt-3 space-y-2">
            {shortlist.map((c) => (
              <li key={c.domain} className="rounded-xl border border-edge bg-ink/40 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <a
                    href={`https://porkbun.com/checkout/search?q=${encodeURIComponent(c.domain)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate font-mono text-sm text-free hover:underline"
                  >
                    {c.domain}
                  </a>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{c.score}</span>
                </div>

                <p className="mt-1 font-mono text-[11px] text-muted">
                  {formatPrice(c.renewUsd ?? c.priceUsd, currency, rates) ?? "—"}/yr
                  {c.trust !== undefined && ` · trust ${c.trust}`}
                </p>
                <Markdown text={c.reason} className="mt-1.5 text-xs leading-relaxed text-muted" />
              </li>
            ))}
          </ul>
        </div>

        {usage && (
          <div className="rounded-2xl border border-edge bg-panel/70 p-4 text-xs">
            <p className="text-muted">Spend so far</p>
            <p className="mt-1 font-mono text-lg">${usage.costUsd.toFixed(3)}</p>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">
              in {usage.input.toLocaleString()} · out {usage.output.toLocaleString()}
              <br />
              cached {usage.cacheRead.toLocaleString()} read / {usage.cacheWrite.toLocaleString()} written
            </p>
            {usage.cacheRead > 0 && (
              <p className="mt-2 text-[10px] text-free">
                Caching saved about $
                {((usage.cacheRead * (5 - 0.5)) / 1_000_000).toFixed(3)} on re-read context.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

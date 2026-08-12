"use client";

import { useState } from "react";
import type { AuditReport } from "@/lib/audit";

const LEVEL = {
  clean: { label: "Clean", cls: "text-free", ring: "stroke-free" },
  ok: { label: "Fine", cls: "text-free", ring: "stroke-free" },
  warn: { label: "Caution", cls: "text-sale", ring: "stroke-sale" },
  bad: { label: "Risky", cls: "text-taken", ring: "stroke-taken" },
} as const;

export default function AuditPanel({ domain }: { domain: string }) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit?domain=${encodeURIComponent(domain)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Audit failed.");
      setReport(json as AuditReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!report) {
    return (
      <div className="space-y-2">
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand/20 disabled:opacity-50"
        >
          {loading ? "Searching the archive…" : "Audit domain history"}
        </button>
        {error && <p className="text-xs text-taken">{error}</p>}
        {!error && (
          <p className="text-[11px] text-muted">
            Walks the Internet Archive: what used to run on this name, and whether it
            was gambling, adult or spam.
          </p>
        )}
      </div>
    );
  }

  const level = LEVEL[report.level];
  const circumference = 2 * Math.PI * 26;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0 -rotate-90">
          <circle cx="32" cy="32" r="26" className="fill-none stroke-edge" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r="26"
            className={`fill-none ${level.ring}`}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - report.score / 100)}
          />
          <text
            x="32"
            y="32"
            className={`rotate-90 fill-current text-[18px] font-semibold ${level.cls}`}
            textAnchor="middle"
            dominantBaseline="central"
            transform="rotate(90 32 32)"
          >
            {report.score}
          </text>
        </svg>

        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${level.cls}`}>
            {level.label} · trust score {report.score}/100
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{report.verdict}</p>

          {report.snapshots > 0 && (
            <p className="mt-1 font-mono text-[11px] text-muted">
              {report.snapshots} captures · {report.firstYear}–{report.lastYear} ·{" "}
              {report.activeYears} years
              {report.certCount !== undefined && ` · ${report.certCount} TLS certs`}
            </p>
          )}
        </div>
      </div>

      {report.flags.length > 0 && (
        <ul className="space-y-1">
          {report.flags.map((f) => (
            <li
              key={f.id}
              className="rounded-md border border-taken/30 bg-taken/5 px-2.5 py-1.5 text-xs"
            >
              <span className="font-medium text-taken">{f.label}</span>
              <span className="text-muted"> — {f.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {report.samples.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-muted">What used to be here:</p>
          <ul className="space-y-1">
            {report.samples.map((s) => (
              <li key={s.timestamp} className="truncate text-xs">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand hover:underline"
                >
                  {s.year}
                </a>
                <span className="ml-2 text-muted">{s.title ?? "(no title)"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

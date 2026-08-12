"use client";

import { useEffect, useState } from "react";
import AgentPanel from "./AgentPanel";
import DomainSearch from "./DomainSearch";
import { api } from "@/lib/basePath";
import type { Currency, Rates } from "@/lib/fx";

type Mode = "sweep" | "agent";

export default function Workspace() {
  const [mode, setMode] = useState<Mode>("sweep");
  const [rates, setRates] = useState<Rates | null>(null);
  const [currency, setCurrency] = useState<Currency>("CZK");

  // FX is shared by both modes, so it lives here rather than in either one
  useEffect(() => {
    fetch(api("/api/rates"))
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && !r.error && setRates(r as Rates))
      .catch(() => setCurrency("USD"));
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-12">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            TLD <span className="text-brand">Hunter</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {mode === "sweep"
              ? "One name against every TLD on earth. Rows turn green when the name is free, blue when it is listed on the aftermarket, red when it is taken. Click any row for registry data and a history audit."
              : "Describe what you are building and an agent hunts for you — it invents names, checks them against real registries, audits their history, and shortlists what survives."}
          </p>
        </div>

        <div className="flex shrink-0 rounded-xl border border-edge bg-panel p-1">
          {(
            [
              { id: "sweep", label: "Sweep one name" },
              { id: "agent", label: "AI agent" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                mode === m.id ? "bg-brand/15 text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {mode === "sweep" ? (
        <DomainSearch currency={currency} rates={rates} onCurrency={setCurrency} />
      ) : (
        <AgentPanel currency={currency} rates={rates} />
      )}
    </main>
  );
}

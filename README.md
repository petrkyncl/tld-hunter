# TLD Hunter

One name against every TLD on earth: what is available and at what price, what is
listed on the aftermarket, what is taken — plus a history audit of any name.

## How a scan works

1. **Catalogue** (`/api/tlds`) — every TLD in the IANA root plus the multi-label
   suffixes registrars actually sell (`co.uk`, `com.au`). Rendered as pending rows
   before the user types anything.
2. **Phase 1 — DNS sweep** (`/api/scan`, streamed NDJSON). A DNS-over-HTTPS `NS`
   query per name against Cloudflare and Google. A delegation is proof of
   registration; parking nameservers identify aftermarket listings. Seconds for
   ~1500 names.
3. **Phase 2 — registry verification**, automatic and streamed as corrections.
   `NXDOMAIN` does not prove availability (a registered name may simply have no
   nameservers), so every unsettled name is checked against the registry: RDAP
   where it exists, port-43 WHOIS where it does not. Rows carry a `?` until this
   pass reaches them.

Registries throttle aggressively — Identity Digital serves ~450 TLDs from a
single endpoint and will 403 an entire IP after a burst — so RDAP is capped at
two in-flight requests per endpoint with a minimum gap and a circuit breaker,
and WHOIS at one.

## The AI agent

The second tab hands the search to an agent (Claude Opus 5) instead of a query
box. You describe what you are building, a budget, and any names you already
tried; it invents candidates, checks them with the same engine the sweep uses,
audits the history of its finalists, and shortlists what survives — streaming
its reasoning and every find as it goes.

Cost control is three layers, because an open-ended loop is the easiest way to
burn an API balance:

- **Prompt caching** — the system prompt and tool definitions are cached, so
  every later turn re-reads the fixed prefix at a tenth of the input price.
- **Task budgets** — the model is told its token budget and paces itself,
  finishing gracefully instead of being cut off.
- **Compact tool results** — a tool never returns hundreds of rows. Everything
  a tool returns is re-sent on every subsequent turn, so verbose results are
  the most expensive mistake a harness can make.

The depth selector maps to effort, task budget, and an iteration cap; the panel
shows live spend so a run can never surprise you. Requires `ANTHROPIC_API_KEY`
— without it the sweep still works and the agent says what is missing.

## Data sources (all free, no API keys)

| What | Source |
| --- | --- |
| TLD list | IANA root zone database |
| Availability | DNS over HTTPS, registry RDAP (IANA bootstrap + overrides), port-43 WHOIS |
| Prices | Porkbun public price list (USD, standard tier) |
| FX rates | ČNB daily fixing, ECB/Frankfurter as fallback |
| Aftermarket | Nameserver fingerprints of Afternic, Sedo, Dan, HugeDomains, … |
| History audit | Internet Archive CDX + snapshot content, crt.sh (best effort) |
| AI agent | Claude Opus 5 via the Anthropic API (the one component that needs a key) |

Prices come from a single registrar because it is the only one publishing a
price list without an API key. Treat them as a ballpark, not a quote.

## Development

```bash
npm install
npm run dev
```

Optional configuration lives in `.env.example`.

## Deployment

GitHub Actions workflow with a manual trigger (`workflow_dispatch`): SSH to the
VPS, `git pull --ff-only`, `npm ci && npm run build`, `pm2 reload tld-hunter`.
Pushing to `main` never deploys on its own.

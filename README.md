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

## Data sources (all free, no API keys)

| What | Source |
| --- | --- |
| TLD list | IANA root zone database |
| Availability | DNS over HTTPS, registry RDAP (IANA bootstrap + overrides), port-43 WHOIS |
| Prices | Porkbun public price list (USD, standard tier) |
| FX rates | ČNB daily fixing, ECB/Frankfurter as fallback |
| Aftermarket | Nameserver fingerprints of Afternic, Sedo, Dan, HugeDomains, … |
| History audit | Internet Archive CDX + snapshot content, crt.sh (best effort) |

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

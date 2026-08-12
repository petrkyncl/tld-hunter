import { auditDomain } from "@/lib/audit";
import { CATEGORIES } from "@/lib/categories";
import { checkDomains, listTlds, sweepName, type SweepFilters } from "./search";

/**
 * The agent's tool surface. Every result is deliberately compact: a tool that
 * dumps hundreds of rows into the transcript is re-sent on every subsequent
 * turn of the loop, so verbose results are the single most expensive mistake
 * an agent harness can make.
 */

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export interface Candidate {
  domain: string;
  priceUsd?: number;
  renewUsd?: number;
  reason: string;
  score: number;
  trust?: number;
}

export interface ToolContext {
  filters: SweepFilters;
  signal?: AbortSignal;
  onCandidate: (c: Candidate) => void;
  onActivity: (a: { tool: string; detail: string }) => void;
}

export const TOOLS = [
  {
    name: "sweep_name",
    description:
      "Check one second-level name against the TLD space. " +
      "Returns only registry-confirmed availability plus any aftermarket listings. " +
      "This is the main tool — call it for every name idea you want to evaluate. " +
      "You can call it several times in one turn to evaluate a batch of ideas in parallel.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The second-level name only, without any dot or suffix, e.g. 'lumora'.",
        },
        must_include_tlds: {
          type: "array",
          items: { type: "string" },
          description:
            "Suffixes to check even if they fall outside the price ceiling or category filters, e.g. ['com','cz'].",
        },
        max_price_usd: {
          type: "number",
          description:
            "Optional yearly-renewal ceiling in USD for this call. Choose it yourself from what the user said about price; leave it out to search the whole price range.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "check_domains",
    description:
      "Authoritative status for up to 20 exact domains you already have in mind. " +
      "Use when you want specific full domains rather than one name across many suffixes.",
    input_schema: {
      type: "object",
      properties: {
        domains: {
          type: "array",
          items: { type: "string" },
          description: "Full domains, e.g. ['lumora.io','lumora.dev'].",
        },
      },
      required: ["domains"],
    },
  },
  {
    name: "list_tlds",
    description:
      "Which suffixes exist inside the brief's constraints, with prices. " +
      "Call this once early to learn the price landscape before generating name ideas.",
    input_schema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: { type: "string", enum: CATEGORY_IDS },
          description: "Restrict to these categories.",
        },
        max_price_usd: {
          type: "number",
          description: "Optional yearly-renewal ceiling in USD. Leave out to see the full range.",
        },
        limit: { type: "integer", description: "Max suffixes to return (default 40)." },
      },
    },
  },
  {
    name: "audit_domain",
    description:
      "History check for one domain via the Internet Archive: what used to run there and whether it was " +
      "gambling, adult or spam content. Returns a 0-100 trust score. " +
      "Only call this for finalists — it is the slowest tool.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Full domain, e.g. 'lumora.io'." },
      },
      required: ["domain"],
    },
  },
  {
    name: "save_candidate",
    description:
      "Add a domain to the user's shortlist. Call this the moment you find something good — the user " +
      "sees the shortlist grow live, so do not wait until the end to report everything at once. " +
      "Only save domains a tool has confirmed as available or for sale.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        reason: {
          type: "string",
          description: "One or two sentences on why this fits the brief specifically.",
        },
        score: { type: "integer", description: "Your rating, 0-100." },
      },
      required: ["domain", "reason", "score"],
    },
  },
] as const;

/** Executes one tool call and returns the compact string the model will read. */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    case "sweep_name": {
      const label = String(input.name ?? "");
      const mustInclude = Array.isArray(input.must_include_tlds)
        ? (input.must_include_tlds as string[])
        : undefined;
      ctx.onActivity({ tool: "sweep_name", detail: label });

      const maxPriceUsd = Number.isFinite(input.max_price_usd)
        ? Number(input.max_price_usd)
        : ctx.filters.maxPriceUsd;

      const res = await sweepName(
        label,
        { ...ctx.filters, maxPriceUsd, mustInclude },
        { signal: ctx.signal },
      );
      if ("error" in res) return `error: ${res.error}`;

      const free = res.available
        .slice(0, 18)
        .map((h) => `${h.domain} $${(h.renew ?? h.price ?? 0).toFixed(0)}/yr`)
        .join(", ");
      const sale = res.forSale
        .slice(0, 6)
        .map((h) => `${h.domain} (${h.market})`)
        .join(", ");

      return [
        `name=${res.name} checked=${res.checked} taken=${res.takenCount} unresolved=${res.unresolved}`,
        `available(${res.available.length}): ${free || "none"}`,
        `for_sale(${res.forSale.length}): ${sale || "none"}`,
      ].join("\n");
    }

    case "check_domains": {
      const domains = Array.isArray(input.domains) ? (input.domains as string[]) : [];
      ctx.onActivity({ tool: "check_domains", detail: domains.slice(0, 4).join(", ") });

      const res = await checkDomains(domains, ctx.signal);
      if (!res.length) return "error: no valid domains given";
      return res
        .map(
          (r) =>
            `${r.domain}: ${r.status}${r.renew !== undefined ? ` ($${r.renew.toFixed(0)}/yr)` : ""}`,
        )
        .join("\n");
    }

    case "list_tlds": {
      const limit = Math.min(Number(input.limit) || 40, 80);
      const categories = Array.isArray(input.categories)
        ? (input.categories as SweepFilters["categories"])
        : ctx.filters.categories;
      ctx.onActivity({ tool: "list_tlds", detail: categories?.join(", ") ?? "all" });

      const maxPriceUsd = Number.isFinite(input.max_price_usd)
        ? Number(input.max_price_usd)
        : ctx.filters.maxPriceUsd;

      const res = await listTlds({ ...ctx.filters, categories, maxPriceUsd, limit });
      if (!res.length) return "no suffixes match those constraints — loosen the budget or categories";
      return res
        .map((t) => `.${t.tld} $${(t.renew ?? t.price ?? 0).toFixed(0)}/yr`)
        .join(", ");
    }

    case "audit_domain": {
      const domain = String(input.domain ?? "");
      ctx.onActivity({ tool: "audit_domain", detail: domain });

      const report = await auditDomain(domain, { signal: ctx.signal });
      const flags = report.flags.map((f) => f.label).join(", ") || "none";
      return [
        `domain=${report.domain} trust=${report.score}/100 (${report.level})`,
        `history: ${report.snapshots} captures${report.firstYear ? ` ${report.firstYear}-${report.lastYear}` : ""}`,
        `risk_flags: ${flags}`,
        report.verdict,
      ].join("\n");
    }

    case "save_candidate": {
      const domain = String(input.domain ?? "");
      const tld = domain.split(".").slice(1).join(".");
      const [checked] = await checkDomains([domain], ctx.signal);

      // The shortlist is the deliverable — never let an unverified name onto it.
      if (!checked || (checked.status !== "free" && !checked.status.startsWith("for sale"))) {
        return `rejected: ${domain} is ${checked?.status ?? "unverifiable"} — do not save it`;
      }

      ctx.onCandidate({
        domain,
        priceUsd: checked.price,
        renewUsd: checked.renew,
        reason: String(input.reason ?? ""),
        score: Math.max(0, Math.min(100, Number(input.score) || 0)),
      });
      ctx.onActivity({ tool: "save_candidate", detail: domain });
      return `saved ${domain}${tld ? "" : ""} — shown to the user`;
    }

    default:
      return `error: unknown tool ${name}`;
  }
}

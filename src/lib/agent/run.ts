import Anthropic from "@anthropic-ai/sdk";
import type { CategoryId } from "@/lib/categories";
import { runTool, TOOLS, type Candidate } from "./tools";

/**
 * The agent loop. Claude plans, calls the search tools, reads the results and
 * decides what to try next, until it has a shortlist or runs out of budget.
 *
 * Cost control is three layers, because an open-ended loop is the easiest way
 * to burn an API balance: a task budget the model can see and pace itself
 * against, a hard iteration cap the model cannot exceed, and tool results kept
 * compact — every token a tool returns is re-sent on every later turn.
 */

const MODEL = "claude-opus-5";

/** USD per million tokens. Cache reads are a tenth of input, which is the whole game. */
const PRICE = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

export type Depth = "quick" | "normal" | "deep";

const DEPTH: Record<Depth, { effort: string; taskBudget: number; maxIterations: number }> = {
  quick: { effort: "low", taskBudget: 20_000, maxIterations: 8 },
  normal: { effort: "medium", taskBudget: 45_000, maxIterations: 20 },
  deep: { effort: "high", taskBudget: 120_000, maxIterations: 40 },
};

export interface AgentBrief {
  /** What the user is building and for whom — the thing only they know. */
  useCase: string;
  maxPriceUsd?: number;
  categories?: CategoryId[];
  maxTldLength?: number;
  seedNames?: string[];
  depth: Depth;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; detail: string }
  | { type: "candidate"; candidate: Candidate }
  | { type: "usage"; usage: Usage; iteration: number; maxIterations: number }
  | { type: "done"; reason: string }
  | { type: "error"; message: string };

function systemPrompt(brief: AgentBrief): string {
  const constraints = [
    brief.maxPriceUsd !== undefined
      ? `Yearly renewal budget: up to $${brief.maxPriceUsd} per year. The renewal price matters, not the first-year teaser.`
      : "No hard budget, but prefer suffixes that renew cheaply.",
    brief.categories?.length ? `Preferred TLD categories: ${brief.categories.join(", ")}.` : null,
    brief.maxTldLength ? `Keep suffixes to ${brief.maxTldLength} characters or fewer.` : null,
    brief.seedNames?.length
      ? `The user already has these ideas — evaluate them first, then go beyond them: ${brief.seedNames.join(", ")}.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a domain-hunting agent. You have tools that check real registries, so every claim you make is verifiable — never guess whether a domain is free.

# The user's brief
${brief.useCase}

# Constraints
${constraints}

# How to work
Start by calling list_tlds once to learn what the budget actually buys. Then evaluate the user's own ideas if they gave any.

After that, generate your own names and test them. Work in batches: call sweep_name several times in one turn rather than one name per turn — parallel calls cost the same and finish far sooner. Between batches, look at what came back and let it steer you: if a whole direction is taken, that tells you the space is crowded and you should shift register (invented words, compounds, a different metaphor, a different language) rather than trying near-misses of a name that is already gone.

Call save_candidate the moment a name is worth the user's attention. They watch the shortlist fill up live, so a good find should appear immediately, not in a summary at the end. For your strongest finalists, call audit_domain first — a name with gambling or adult content in its history is worth less than a clean one, and the user needs to know before they buy.

Stop when you have 5-8 genuinely good candidates, or when the remaining budget is better spent finishing than continuing. Say so and stop; do not pad the loop.

# What makes a candidate good
It fits this user's use case specifically, not domains in general. Short and sayable beats clever. A .com is worth more than a novelty suffix at the same price, but a memorable name on a fitting suffix beats a forgettable one on .com. Respect the budget — a name they cannot afford to renew is not a find.

# Communicating
Your text between tool calls is what the user reads while waiting. Say what you are about to try and why, in a sentence. When you finish, lead with the outcome: the two or three names you would actually pick, and why. Keep it brief — the shortlist already shows the details, so do not repeat it back.

Deliver what was asked at the scope intended. If the brief is too narrow to yield anything good, say so plainly rather than lowering your bar and filling the shortlist with weak names.`;
}

function accumulate(usage: Usage, u: Anthropic.Beta.BetaUsage | undefined): Usage {
  if (!u) return usage;
  const input = usage.input + (u.input_tokens ?? 0);
  const output = usage.output + (u.output_tokens ?? 0);
  const cacheRead = usage.cacheRead + (u.cache_read_input_tokens ?? 0);
  const cacheWrite = usage.cacheWrite + (u.cache_creation_input_tokens ?? 0);

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    costUsd:
      (input * PRICE.input +
        output * PRICE.output +
        cacheRead * PRICE.cacheRead +
        cacheWrite * PRICE.cacheWrite) /
      1_000_000,
  };
}

export async function runAgent(
  brief: AgentBrief,
  emit: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    emit({
      type: "error",
      message:
        "No ANTHROPIC_API_KEY configured. Add it to .env.local and restart the server.",
    });
    return;
  }

  const cfg = DEPTH[brief.depth] ?? DEPTH.normal;
  const client = new Anthropic();
  let usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };

  const ctx = {
    filters: {
      maxPriceUsd: brief.maxPriceUsd,
      categories: brief.categories,
      maxTldLength: brief.maxTldLength,
    },
    signal,
    onCandidate: (candidate: Candidate) => emit({ type: "candidate", candidate }),
    onActivity: (a: { tool: string; detail: string }) =>
      emit({ type: "tool", tool: a.tool, detail: a.detail }),
  };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        "Find domains that fit my brief. Start now — do not ask me clarifying questions, work with what the brief says.",
    },
  ];

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    {
      type: "text",
      text: systemPrompt(brief),
      // Tools render before system, so one breakpoint here caches both — the
      // fixed prefix is re-read at a tenth of the price on every later turn.
      cache_control: { type: "ephemeral" },
    },
  ];

  for (let iteration = 1; iteration <= cfg.maxIterations; iteration++) {
    if (signal?.aborted) {
      emit({ type: "done", reason: "stopped" });
      return;
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 8000,
          betas: ["task-budgets-2026-03-13"],
          thinking: { type: "adaptive", display: "summarized" },
          output_config: {
            effort: cfg.effort,
            task_budget: { type: "tokens", total: cfg.taskBudget },
          },
          system,
          tools: TOOLS,
          messages,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- task_budget/effort typings lag the API
        } as any,
        { signal },
      );

      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "thinking_delta") {
          emit({ type: "thinking", text: event.delta.thinking });
        } else if (event.delta.type === "text_delta") {
          emit({ type: "text", text: event.delta.text });
        }
      }

      message = await stream.finalMessage();
    } catch (err) {
      if (signal?.aborted) {
        emit({ type: "done", reason: "stopped" });
        return;
      }
      emit({ type: "error", message: err instanceof Error ? err.message : "Model call failed." });
      return;
    }

    usage = accumulate(usage, message.usage);
    emit({ type: "usage", usage, iteration, maxIterations: cfg.maxIterations });

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined this request." });
      return;
    }

    // Thinking blocks must go back unchanged or the next turn is rejected.
    messages.push({ role: "assistant", content: message.content });

    const calls = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );

    if (!calls.length) {
      emit({ type: "done", reason: "finished" });
      return;
    }

    const results = await Promise.all(
      calls.map(async (call) => {
        try {
          const text = await runTool(call.name, call.input as Record<string, unknown>, ctx);
          return { type: "tool_result" as const, tool_use_id: call.id, content: text };
        } catch (err) {
          return {
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: err instanceof Error ? err.message : "tool failed",
            is_error: true,
          };
        }
      }),
    );

    // Second breakpoint on the growing transcript, so each turn re-reads the
    // whole conversation from cache instead of paying full input price.
    const last = results[results.length - 1] as Anthropic.Beta.BetaToolResultBlockParam;
    last.cache_control = { type: "ephemeral" };

    messages.push({ role: "user", content: results });
  }

  emit({ type: "done", reason: "iteration limit reached" });
}

export const DEPTH_INFO: Record<Depth, { label: string; estimate: string }> = {
  quick: { label: "Quick", estimate: "~$0.10 · under a minute" },
  normal: { label: "Normal", estimate: "~$0.35 · a few minutes" },
  deep: { label: "Deep", estimate: "~$0.80 · up to ten minutes" },
};

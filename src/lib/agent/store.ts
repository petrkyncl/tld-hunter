import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentBrief, AgentEvent, Usage } from "./run";

/**
 * Runs outlive the request that started them.
 *
 * The agent used to be driven straight from the POST handler with the
 * request's abort signal, so a dropped wifi connection killed work that was
 * happening on the server and had nothing to do with the browser. A run now
 * owns its own lifetime: the client starts it, then attaches to its event
 * stream, and can reattach — from a reload, another tab, or tomorrow.
 *
 * Events are kept in memory for live tailing and mirrored to disk so a
 * finished run is still there after a deploy.
 */

const DATA_DIR = process.env.AGENT_DATA_DIR ?? path.join(process.cwd(), ".data", "runs");
const MAX_LIVE_RUNS = 2;
const FLUSH_MS = 2000;

export type RunStatus = "running" | "done" | "error" | "stopped" | "interrupted";

export interface RunRecord {
  id: string;
  title: string;
  brief: AgentBrief;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  events: AgentEvent[];
  usage?: Usage;
}

interface LiveRun {
  record: RunRecord;
  controller: AbortController;
  subscribers: Set<(event: AgentEvent, index: number) => void>;
  dirty: boolean;
  timer?: NodeJS.Timeout;
}

const live = new Map<string, LiveRun>();

function titleOf(brief: AgentBrief): string {
  const line = brief.useCase.trim().split("\n")[0];
  return line.length > 70 ? `${line.slice(0, 68)}…` : line;
}

async function persist(run: LiveRun) {
  run.dirty = false;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      path.join(DATA_DIR, `${run.record.id}.json`),
      JSON.stringify(run.record),
      "utf8",
    );
  } catch {
    // Losing the archive copy must never take the running agent down with it.
  }
}

/** Batched so a chatty run does not turn into a write per token. */
function scheduleFlush(run: LiveRun) {
  run.dirty = true;
  if (run.timer) return;
  run.timer = setTimeout(() => {
    run.timer = undefined;
    if (run.dirty) void persist(run);
  }, FLUSH_MS);
}

export function countRunning(): number {
  return [...live.values()].filter((r) => r.record.status === "running").length;
}

export function atCapacity(): boolean {
  return countRunning() >= MAX_LIVE_RUNS;
}

export function createRun(brief: AgentBrief): { id: string; signal: AbortSignal } {
  const id = randomUUID();
  const controller = new AbortController();

  const run: LiveRun = {
    record: {
      id,
      title: titleOf(brief),
      brief,
      status: "running",
      startedAt: new Date().toISOString(),
      events: [],
    },
    controller,
    subscribers: new Set(),
    dirty: false,
  };

  live.set(id, run);
  void persist(run);
  return { id, signal: controller.signal };
}

export function appendEvent(id: string, event: AgentEvent) {
  const run = live.get(id);
  if (!run) return;

  const index = run.record.events.length;
  run.record.events.push(event);
  if (event.type === "usage") run.record.usage = event.usage;

  for (const notify of run.subscribers) notify(event, index);
  scheduleFlush(run);
}

export function finishRun(id: string, status: RunStatus, reason: string = status) {
  const run = live.get(id);
  if (!run || run.record.status !== "running") return;

  run.record.status = status;
  run.record.endedAt = new Date().toISOString();

  // The terminal event is emitted here and nowhere else, so a client sees
  // exactly one — whether the run ended, was stopped, or failed.
  const done: AgentEvent = { type: "done", reason };
  run.record.events.push(done);
  for (const notify of run.subscribers) notify(done, run.record.events.length - 1);
  if (run.timer) clearTimeout(run.timer);
  void persist(run);
}

export function stopRun(id: string): boolean {
  const run = live.get(id);
  if (!run || run.record.status !== "running") return false;
  run.controller.abort();
  return true;
}

/**
 * Replays what already happened, then follows along. `from` lets a client that
 * lost its connection pick up exactly where it stopped reading.
 */
export function attach(
  id: string,
  from: number,
  onEvent: (event: AgentEvent, index: number) => void,
): { backlog: Array<{ event: AgentEvent; index: number }>; done: boolean; detach: () => void } {
  const run = live.get(id);
  if (!run) return { backlog: [], done: true, detach: () => {} };

  const backlog = run.record.events
    .slice(from)
    .map((event, i) => ({ event, index: from + i }));

  if (run.record.status !== "running") {
    return { backlog, done: true, detach: () => {} };
  }

  run.subscribers.add(onEvent);
  return { backlog, done: false, detach: () => run.subscribers.delete(onEvent) };
}

export async function getRun(id: string): Promise<RunRecord | null> {
  const inMemory = live.get(id);
  if (inMemory) return inMemory.record;

  try {
    const raw = await readFile(path.join(DATA_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as RunRecord;
  } catch {
    return null;
  }
}

export interface RunSummary {
  id: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  candidates: number;
  costUsd?: number;
}

export async function listRuns(limit = 30): Promise<RunSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const records = await Promise.all(
    files.map(async (file) => {
      const id = file.replace(/\.json$/, "");
      return live.get(id)?.record ?? (await getRun(id));
    }),
  );

  return records
    .filter((r): r is RunRecord => r !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      title: r.title,
      // A run recorded as running that no process owns died with a restart.
      status: r.status === "running" && !live.has(r.id) ? "interrupted" : r.status,
      startedAt: r.startedAt,
      candidates: r.events.filter((e) => e.type === "candidate").length,
      costUsd: r.usage?.costUsd,
    }));
}

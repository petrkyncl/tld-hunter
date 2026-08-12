/** Bounded-concurrency task pool that yields results as soon as each task settles. */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onResult: (result: R, item: T, index: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  let next = 0;
  let done = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next++;
      try {
        const r = await worker(items[i], i);
        if (signal?.aborted) return;
        onResult(r, items[i], i);
      } catch {
        // a single failed lookup must not kill the scan
      }
      done++;
    }
  });

  await Promise.all(runners);
  return done;
}

/** Per-key concurrency gate — keeps us polite to individual RDAP registries. */
export class KeyedSemaphore {
  private active = new Map<string, number>();
  private queues = new Map<string, Array<() => void>>();

  constructor(private readonly limit: number) {}

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }

  private acquire(key: string): Promise<void> {
    const n = this.active.get(key) ?? 0;
    if (n < this.limit) {
      this.active.set(key, n + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const q = this.queues.get(key) ?? [];
      q.push(resolve);
      this.queues.set(key, q);
    });
  }

  private release(key: string) {
    const q = this.queues.get(key);
    if (q && q.length) {
      q.shift()!();
      return;
    }
    const n = (this.active.get(key) ?? 1) - 1;
    if (n <= 0) this.active.delete(key);
    else this.active.set(key, n);
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

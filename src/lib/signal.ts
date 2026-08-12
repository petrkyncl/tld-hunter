/**
 * Combines the caller's abort signal with a hard timeout. Passing only the
 * caller's signal to fetch() would silently drop the timeout, which lets a
 * single unresponsive registry stall a whole scan.
 */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

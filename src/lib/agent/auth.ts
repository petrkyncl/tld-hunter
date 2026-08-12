import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The agent endpoint spends real money on every call, and the deployed tool
 * sits on a public URL. When AGENT_ACCESS_CODE is set, a request must carry
 * it or it never reaches the model; when it is unset — local development —
 * the endpoint is open, so nothing gets in the way while building.
 */
const HEADER = "x-agent-code";

/** Hashing first keeps the comparison constant-time regardless of length. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function accessRequired(): boolean {
  return Boolean(process.env.AGENT_ACCESS_CODE);
}

export function hasAccess(req: Request): boolean {
  const expected = process.env.AGENT_ACCESS_CODE;
  if (!expected) return true;

  const provided = req.headers.get(HEADER);
  if (!provided) return false;

  return timingSafeEqual(digest(provided), digest(expected));
}

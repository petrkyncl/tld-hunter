import net from "node:net";
import { cached, DAY } from "./cache";
import { KeyedSemaphore, sleep } from "./pool";
import { rootOf } from "./tlds";

/**
 * Port-43 WHOIS, used only where RDAP does not exist — that is still a large
 * part of the ccTLD space (.de, .sk, .pl, .it, .eu ...). Registries are much
 * stricter here than on RDAP, so it runs one query at a time per server.
 */

const gate = new KeyedSemaphore(1);
const MIN_GAP_MS = 400;
const lastCall = new Map<string, number>();

/** Registries whose IANA record points somewhere useless or nowhere at all. */
const WHOIS_OVERRIDES: Record<string, string> = {
  de: "whois.nic.de",
  eu: "whois.eu",
  sk: "whois.sk-nic.sk",
  pl: "whois.dns.pl",
  it: "whois.nic.it",
  ch: "whois.nic.ch",
  li: "whois.nic.li",
  be: "whois.dns.be",
  no: "whois.norid.no",
  hu: "whois.nic.hu",
  si: "whois.register.si",
};

function ask(server: string, query: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(43, server);
    let data = "";

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.length > 200_000) socket.destroy();
    });
    socket.on("end", () => resolve(data));
    socket.on("close", () => resolve(data));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("whois timeout"));
    });
    socket.on("error", reject);
  });
}

/** IANA's own WHOIS knows which server is authoritative for a TLD. */
async function serverFor(tld: string): Promise<string | undefined> {
  const root = rootOf(tld);
  if (WHOIS_OVERRIDES[root]) return WHOIS_OVERRIDES[root];

  return cached(`whois:server:${root}`, DAY, async () => {
    try {
      const text = await ask("whois.iana.org", root, 6000);
      return /^whois:\s*(\S+)/mi.exec(text)?.[1]?.toLowerCase();
    } catch {
      return undefined;
    }
  });
}

const FREE_PATTERNS = [
  /\bno match\b/i,
  /\bnot found\b/i,
  /\bno entries found\b/i,
  /\bno data found\b/i,
  /\bno object found\b/i,
  /\bnothing found\b/i,
  /\bdomain (name )?(is )?(not registered|available|free)\b/i,
  /^\s*status:\s*(free|available)\s*$/im,
  /\bstatus:\s*AVAILABLE\b/,
  /\bno information available about domain name\b/i,
  /\bthis domain name has not been registered\b/i,
  /^%\s*no entries found/im,
  /\bnot been registered\b/i,
];

const TAKEN_PATTERNS = [
  /^\s*(domain name|domain|nazev domeny):/im,
  /^\s*(registrar|registrant|holder|org|owner):/im,
  /^\s*(creation date|created|registered on|changed):/im,
  /^\s*(nserver|name server|nameserver|ns):/im,
];

export type WhoisVerdict = "available" | "registered" | "unknown";

export async function whoisLookup(
  domain: string,
  tld: string,
  signal?: AbortSignal,
): Promise<WhoisVerdict> {
  const server = await serverFor(tld);
  if (!server || signal?.aborted) return "unknown";

  return gate.run(server, async () => {
    const wait = MIN_GAP_MS - (Date.now() - (lastCall.get(server) ?? 0));
    if (wait > 0) await sleep(wait);
    lastCall.set(server, Date.now());

    let text: string;
    try {
      text = await ask(server, domain);
    } catch {
      return "unknown";
    }

    // rate-limit / refusal answers must never be read as "available"
    if (/\b(quota exceeded|rate limit|too many requests|access denied|blocked)\b/i.test(text)) {
      return "unknown";
    }
    if (FREE_PATTERNS.some((re) => re.test(text))) return "available";
    if (TAKEN_PATTERNS.some((re) => re.test(text))) return "registered";
    return "unknown";
  });
}

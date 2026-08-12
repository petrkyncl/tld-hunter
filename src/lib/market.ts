import { cached, HOUR } from "./cache";
import { KeyedSemaphore, sleep } from "./pool";
import { withTimeout } from "./signal";

/**
 * Aftermarket listings from Afternic (GoDaddy), the largest domain marketplace.
 *
 * Nameserver fingerprinting only catches a domain whose owner parked it with a
 * marketplace's DNS — plenty of listed domains keep their own nameservers, so
 * a sweep alone reports them as plain "taken". Afternic knows regardless, and
 * publishes the asking price on the listing page, which is how the instant
 * search tools can quote a number the moment you type a name.
 *
 * This is a per-domain lookup, never a bulk one: it runs when the user opens a
 * row or asks for it, capped and cached, not across a 1500-row sweep.
 */

const BASE = "https://www.afternic.com/domain/";

/** Their page is a normal browser page; a default fetch UA gets challenged. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const gate = new KeyedSemaphore(3);
const MIN_GAP_MS = 250;
let lastCall = 0;

export interface Listing {
  domain: string;
  listed: boolean;
  /** Buy-now asking price in USD, when the seller published one. */
  priceUsd?: number;
  /** Floor for a make-an-offer listing, in USD. */
  minOfferUsd?: number;
  source: "Afternic";
  url: string;
}

interface AfternicProfile {
  isForSale?: boolean;
  buyNow?: number;
  minBid?: number;
}

/** Afternic quotes money in micro-units: 19995000000 is $19,995. */
function toUsd(micro: unknown): number | undefined {
  const n = Number(micro);
  return Number.isFinite(n) && n > 0 ? n / 1_000_000 : undefined;
}

function parse(html: string): AfternicProfile | null {
  const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html,
  );
  if (!payload) return null;
  try {
    const json = JSON.parse(payload[1]) as {
      props?: { pageProps?: { profile?: AfternicProfile } };
    };
    return json.props?.pageProps?.profile ?? null;
  } catch {
    return null;
  }
}

async function fetchListing(domain: string, signal?: AbortSignal): Promise<Listing> {
  const url = `${BASE}${encodeURIComponent(domain)}`;
  const notListed: Listing = { domain, listed: false, source: "Afternic", url };

  return gate.run("afternic", async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        signal: withTimeout(12_000, signal),
        redirect: "follow",
        cache: "no-store",
      });
    } catch {
      return notListed;
    }

    // A listing with no published price redirects to GoDaddy's make-an-offer
    // page. The redirect target is the whole signal — its body is bot-walled.
    if (/forsale\.godaddy\.com/i.test(res.url)) {
      void res.body?.cancel();
      return { domain, listed: true, source: "Afternic", url: res.url };
    }

    if (!res.ok) {
      void res.body?.cancel();
      return notListed;
    }

    const profile = parse(await res.text());
    if (!profile?.isForSale) return notListed;

    return {
      domain,
      listed: true,
      priceUsd: toUsd(profile.buyNow),
      minOfferUsd: toUsd(profile.minBid),
      source: "Afternic",
      url,
    };
  });
}

export async function lookupListing(domain: string, signal?: AbortSignal): Promise<Listing> {
  const clean = domain.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) {
    return { domain, listed: false, source: "Afternic", url: "" };
  }
  return cached(`market:${clean}`, 6 * HOUR, () => fetchListing(clean, signal));
}

export function formatAsk(listing: Listing): string {
  if (!listing.listed) return "not listed";
  if (listing.priceUsd) return `$${listing.priceUsd.toLocaleString("en-US")}`;
  if (listing.minOfferUsd) return `offers from $${listing.minOfferUsd.toLocaleString("en-US")}`;
  return "make an offer";
}

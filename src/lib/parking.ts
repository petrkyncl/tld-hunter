import type { Market } from "./types";

/**
 * Nameserver fingerprints of the big domain marketplaces and parking networks.
 * A registered domain sitting on these is almost always listed for sale, which
 * is the only way to spot aftermarket listings without a paid API.
 */
const SIGNATURES: Array<{ match: RegExp; name: string; buy: (d: string) => string }> = [
  {
    match: /(^|\.)afternic\.com$/,
    name: "Afternic",
    buy: (d) => `https://www.afternic.com/domain/${d}`,
  },
  {
    match: /(^|\.)sedoparking\.com$|(^|\.)sedo\.com$/,
    name: "Sedo",
    buy: (d) => `https://sedo.com/search/?keyword=${encodeURIComponent(d)}`,
  },
  {
    match: /(^|\.)dan\.com$|(^|\.)undeveloped\.com$/,
    name: "Dan.com",
    buy: (d) => `https://dan.com/buy-domain/${d}`,
  },
  {
    match: /(^|\.)hugedomains\.com$/,
    name: "HugeDomains",
    buy: (d) => `https://www.hugedomains.com/domain_profile.cfm?d=${d}`,
  },
  {
    match: /(^|\.)squadhelp\.com$|(^|\.)atom\.com$/,
    name: "Atom (Squadhelp)",
    buy: (d) => `https://www.atom.com/search?q=${encodeURIComponent(d)}`,
  },
  {
    match: /(^|\.)brandbucket\.com$/,
    name: "BrandBucket",
    buy: (d) => `https://www.brandbucket.com/search?q=${encodeURIComponent(d)}`,
  },
  {
    match: /(^|\.)domainmarket\.com$/,
    name: "DomainMarket",
    buy: (d) => `https://www.domainmarket.com/buyonline/${d}`,
  },
  {
    match: /(^|\.)efty\.com$/,
    name: "Efty",
    buy: (d) => `https://${d}`,
  },
  {
    match: /(^|\.)sav\.com$/,
    name: "Sav",
    buy: (d) => `https://www.sav.com/domains/${d}`,
  },
  // generic parking networks — monetised pages, very often also for sale
  { match: /(^|\.)bodis\.com$/, name: "Bodis (parking)", buy: (d) => `https://${d}` },
  { match: /(^|\.)parkingcrew\.net$/, name: "ParkingCrew", buy: (d) => `https://${d}` },
  { match: /(^|\.)cashparking\.com$/, name: "GoDaddy parking", buy: (d) => `https://${d}` },
  { match: /(^|\.)above\.com$/, name: "Above.com", buy: (d) => `https://${d}` },
  { match: /(^|\.)fabulous\.com$/, name: "Fabulous", buy: (d) => `https://${d}` },
  { match: /(^|\.)parklogic\.com$/, name: "ParkLogic", buy: (d) => `https://${d}` },
  { match: /(^|\.)voodoo\.com$/, name: "Voodoo (parking)", buy: (d) => `https://${d}` },
  { match: /(^|\.)dsredirection\.com$/, name: "DomainSpa", buy: (d) => `https://${d}` },
  { match: /(^|\.)parkingpage\.namecheap\.com$/, name: "Namecheap parking", buy: (d) => `https://${d}` },
];

export function detectMarket(domain: string, ns: string[]): Market | undefined {
  for (const host of ns) {
    for (const sig of SIGNATURES) {
      if (sig.match.test(host)) return { name: sig.name, url: sig.buy(domain) };
    }
  }
  return undefined;
}

/** Where to look when nothing was detected but the user still wants to buy. */
export function aftermarketLinks(domain: string) {
  return [
    { name: "Afternic", url: `https://www.afternic.com/search?k=${encodeURIComponent(domain)}` },
    { name: "Sedo", url: `https://sedo.com/search/?keyword=${encodeURIComponent(domain)}` },
    { name: "Dan.com", url: `https://dan.com/search?q=${encodeURIComponent(domain)}` },
  ];
}

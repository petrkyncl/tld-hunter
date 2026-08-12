/**
 * Next rewrites links and assets for basePath, but never fetch() URLs — those
 * have to be prefixed by hand or the app breaks when served from a sub-path.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function api(path: string): string {
  return `${BASE}${path}`;
}

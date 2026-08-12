import type { NextConfig } from "next";

/**
 * The app can be served from a sub-path (tools.mationx.com/tld). basePath must
 * be baked in at build time, and client-side fetches are not rewritten by Next,
 * so the same value is exposed to the browser and used by lib/basePath.ts.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;

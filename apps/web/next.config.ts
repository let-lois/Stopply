import type { NextConfig } from "next";

// Static export: the app is a SPA served from Cloudflare Pages while the
// API Worker handles /api/*, /ingest/*, and /t.js on the same hostnames.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;

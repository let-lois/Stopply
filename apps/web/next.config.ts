import type { NextConfig } from "next";

// Static export: the app is a SPA served from Cloudflare Pages while the
// API Worker handles /api/*, /ingest/*, and /t.js on the same hostnames.
//
// The build's commit is baked in so "is my fix live yet?" is answerable
// from the browser instead of inferred from whether the symptom moved.
// Cloudflare Pages sets CF_PAGES_COMMIT_SHA on every build; local builds
// fall back to "dev".
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.CF_PAGES_COMMIT_SHA ?? 'dev').slice(0, 7),
    NEXT_PUBLIC_BUILD_BRANCH: process.env.CF_PAGES_BRANCH ?? 'local',
  },
};

export default nextConfig;

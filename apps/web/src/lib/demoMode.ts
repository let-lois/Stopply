// Preview demo mode. Cloudflare Pages preview deployments (*.pages.dev)
// cannot reach the API Worker at all, it is only attached via Worker
// Routes to bi.letlois.com and *.bi.letlois.com (see wrangler.toml), never
// to pages.dev. So there is no real backend to log into on a preview.
// Demo mode skips login and serves fabricated data instead, see
// demoData.ts, with zero real network calls.
//
// The gate is a runtime hostname check, deliberately not a build-time
// flag: Cloudflare Pages runs the identical build command for preview and
// production, so a build-time env var is not guaranteed to differ between
// them and would be easy to get wrong. window.location.hostname is
// evaluated fresh on every check and can never equal bi.letlois.com (or
// any real domain) while ending in ".pages.dev".
//
// Fails closed: anything other than a hostname that literally ends in
// ".pages.dev" behaves like production, real login, real API calls.
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.location.hostname.endsWith('.pages.dev');
  } catch {
    return false;
  }
}

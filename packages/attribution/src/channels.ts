// Channel derivation shared by the pixel, webhooks, and CSV parsers.
// Priority: utm_source, then site source name, then campaign name, then
// Tags. Click id presence wins over name heuristics for Google and Meta.

export type Channel = 'Google' | 'Meta' | 'Website' | 'Other' | 'Unknown';

export interface ChannelInput {
  utmSource?: string | null;
  siteSourceName?: string | null;
  campaignName?: string | null;
  tags?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  wbraid?: string | null;
  msclkid?: string | null;
  // True when the event arrived via the website pixel or a site form.
  fromWebsite?: boolean;
}

function classify(raw: string): Channel | null {
  const s = raw.toLowerCase();
  if (/google|adwords/.test(s)) return 'Google';
  if (/facebook|meta|\bfb\b|\big\b|instagram/.test(s)) return 'Meta';
  if (/website form|website|web form/.test(s)) return 'Website';
  if (/tiktok/.test(s)) return 'Other';
  return null;
}

export function deriveChannel(input: ChannelInput): Channel {
  // Click ids are the strongest signal.
  if (input.gclid || input.wbraid) return 'Google';
  if (input.fbclid) return 'Meta';

  // The utm fields are empty in some GHL exports, so each fallback in the
  // chain must classify on its own.
  for (const candidate of [input.utmSource, input.siteSourceName, input.campaignName, input.tags]) {
    if (candidate && candidate.trim()) {
      const channel = classify(candidate);
      if (channel) return channel;
    }
  }

  if (input.fromWebsite) return 'Website';
  return 'Unknown';
}

// Reads both `clickld` (lowercase L, as some GHL exports and webhook
// payloads spell it) and `clickid`. Never rename the clickld field.
export function readClickId(record: Record<string, unknown>): string | null {
  for (const key of Object.keys(record)) {
    const lower = key.toLowerCase().replace(/[^a-z]/g, '');
    if (lower === 'clickld' || lower === 'clickid') {
      const v = record[key];
      if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
    }
  }
  return null;
}

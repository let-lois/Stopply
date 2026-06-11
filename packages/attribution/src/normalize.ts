// Normalization helpers. Pure functions, no Worker imports.
// All money is parsed to numbers. All dates normalize to ISO internally.

export function parseMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[$,\s]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const n = Number(cleaned.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : 0;
}

export function parseCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  if (value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Accepts US dates (M/D/YYYY, with optional time) and ISO strings.
// Returns an ISO 8601 string, or null when unparseable.
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  if (!s) return null;

  // ISO already: pass through date only or datetime forms.
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/);
  if (isoMatch) {
    const d = new Date(s.includes('T') || !isoMatch[4] ? s : s.replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    // Date only fallback.
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00.000Z`;
  }

  // US format M/D/YYYY with optional h:mm and am or pm.
  const us = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i
  );
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    let hour = us[4] ? Number(us[4]) : 0;
    const minute = us[5] ? Number(us[5]) : 0;
    const second = us[6] ? Number(us[6]) : 0;
    const ampm = us[7]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function daysBetween(fromIso: string, toIsoStr: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIsoStr).getTime();
  return Math.floor((to - from) / 86400000);
}

export function phoneLast10(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function emailNorm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  return s.includes('@') ? s : null;
}

// Order independent name normalization: tokenize on whitespace, strip non
// letters per token, sort tokens. "Mary-Jane Smith" === "smith maryjane".
export function nameNorm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const tokens = String(value)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ''))
    .filter(Boolean)
    .sort();
  return tokens.length ? tokens.join(' ') : null;
}

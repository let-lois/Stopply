// What outcomes exist, and how far up the funnel each one reaches.
//
// This app shipped with ten outcomes and a hardcoded rank for each. That is
// fine while this app owns the database. It stops being fine the moment the
// data comes from the BI platform, because there a client can rename an
// outcome or add one, and reporting that keys off the name loses the stage the
// day somebody types a new label into a settings page. The platform solved
// this by aggregating on flags instead: is_contact, is_lead, is_appointment,
// is_sale. An outcome called "Left a quote" still counts as a contact and a
// lead because it is marked as one, not because anything recognises the word.
//
// So a catalog is a list of outcomes, each carrying its own rank, and the
// funnel reads ranks. Where the ranks come from is the catalog's business:
// this app's built-in ten declare theirs directly, and the platform's are
// derived from its flags. Nothing downstream knows the difference.

import type { BuiltinDisposition } from '@/modules/field-sales/types';

/**
 * One outcome.
 *
 * `rank` is the ladder from src/modules/field-sales/funnel.ts: 0 the visit
 * does not exist, 1 knocked, 2 contacted, 3 booked, 4 showed, 5 sold. It is
 * "this knock got the door at least this far", so a later stage implies the
 * earlier ones.
 */
export interface DispositionEntry {
  key: string;
  label: string;
  rank: number;
  /** Sticky on the address, and never rolled back. */
  marksDoNotKnock: boolean;
  /** Dark theme. Hex, because a MapLibre paint expression cannot read a CSS variable. */
  hex: string;
  /** Light theme, where it differs. */
  lightHex: string;
}

export interface DispositionCatalog {
  entries: DispositionEntry[];
  rankOf: (key: string) => number;
  labelOf: (key: string) => string;
  hexFor: (theme: 'dark' | 'light') => Record<string, string>;
}

/**
 * The flags the platform stores against each outcome.
 *
 * Numbers, because SQLite has no boolean and D1 hands these back as 0 and 1.
 */
export interface DispositionFlags {
  is_contact: number;
  is_lead: number;
  is_appointment: number;
  is_sale: number;
  marks_do_not_knock: number;
}

/**
 * A rank from the platform's flags.
 *
 * Read downwards, most advanced first, because the flags are cumulative: a
 * sale is also an appointment, a lead and a contact, so testing upwards would
 * stop at contact and flatten every sale into a conversation.
 *
 * There is no flag for a kept appointment. The platform records that a
 * booking was made and not whether anyone turned up, so rank 4 is
 * unreachable from its catalog and the showed row of the funnel is empty for
 * a client whose data comes from there. That is a real gap in the source and
 * is reported as an empty stage rather than papered over by promoting
 * appointments into it, which would claim every booking was kept.
 */
export function rankFromFlags(flags: DispositionFlags): number {
  if (flags.is_sale) return 5;
  if (flags.is_appointment) return 3;
  // A door whose answer was "do not knock" is a contact: somebody opened the
  // door and said so. The platform agrees, and marks that outcome is_contact.
  if (flags.is_contact) return 2;
  return 1;
}

export function buildCatalog(entries: DispositionEntry[]): DispositionCatalog {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return {
    entries,
    // An outcome nobody declared ranks 1: the door was knocked, which is the
    // one thing that is certainly true of any recorded visit. Ranking it 0
    // would drop the knock out of the funnel entirely, so a catalog that
    // arrives incomplete would quietly undercount a crew's day.
    rankOf: (key) => byKey.get(key)?.rank ?? 1,
    labelOf: (key) => byKey.get(key)?.label ?? key,
    hexFor: (theme) =>
      Object.fromEntries(
        entries.map((e) => [e.key, theme === 'light' ? e.lightHex : e.hex])
      ),
  };
}

/**
 * This app's own ten.
 *
 * Typed against the closed union so the compiler still catches a built-in
 * outcome added without a colour or a rank. That check is worth keeping: it is
 * the one that caught the appointment_kept and appointment_missed colours when
 * those stages were added, and losing it was the risk in opening this set up
 * at all.
 */
const BUILTIN: Record<BuiltinDisposition, Omit<DispositionEntry, 'key'>> = {
  not_visited: {
    label: 'Not visited',
    rank: 0,
    marksDoNotKnock: false,
    hex: '#6b7280',
    lightHex: '#6b7280',
  },
  no_answer: {
    label: 'No answer',
    rank: 1,
    marksDoNotKnock: false,
    hex: '#94a3b8',
    // Pale enough on white to read as "no data" rather than as a door
    // somebody knocked and got no answer at.
    lightHex: '#64748b',
  },
  come_back: {
    label: 'Come back later',
    rank: 1,
    marksDoNotKnock: false,
    hex: '#f59e0b',
    lightHex: '#f59e0b',
  },
  not_interested: {
    label: 'Not interested',
    rank: 2,
    marksDoNotKnock: false,
    hex: '#ef4444',
    lightHex: '#ef4444',
  },
  interested: {
    label: 'Interested',
    rank: 2,
    marksDoNotKnock: false,
    hex: '#38bdf8',
    lightHex: '#0ea5e9',
  },
  // Somebody answered and asked to be left alone. That is a conversation, and
  // treating it as a silent door would make a crew's contact rate depend on
  // how politely they were turned away.
  do_not_knock: {
    label: 'Do not knock',
    rank: 2,
    marksDoNotKnock: true,
    // Near-white, so it is the one outcome that stands apart from every hue
    // rather than joining the spectrum. That works on a dark ground and is
    // invisible on a light one, hence the inversion.
    hex: '#f8fafc',
    lightHex: '#1f2937',
  },
  appointment_set: {
    label: 'Appointment set',
    rank: 3,
    marksDoNotKnock: false,
    hex: '#a855f7',
    lightHex: '#a855f7',
  },
  // The booking happened. The appointment is what failed, and the point of the
  // stage is to make that failure visible rather than erase the booking.
  appointment_missed: {
    label: 'No-show',
    rank: 3,
    marksDoNotKnock: false,
    // Rose, a neighbour of the red that means no.
    hex: '#fb7185',
    lightHex: '#fb7185',
  },
  appointment_kept: {
    label: 'Showed',
    rank: 4,
    marksDoNotKnock: false,
    // Indigo, a neighbour of the purple it came from.
    hex: '#6366f1',
    lightHex: '#6366f1',
  },
  closed_sale: {
    label: 'Closed sale',
    rank: 5,
    marksDoNotKnock: false,
    hex: '#10b981',
    lightHex: '#10b981',
  },
};

export const BUILTIN_CATALOG: DispositionCatalog = buildCatalog(
  (Object.keys(BUILTIN) as BuiltinDisposition[]).map((key) => ({ key, ...BUILTIN[key] }))
);

/**
 * Colours for outcomes the catalog did not declare one for.
 *
 * The platform lets a client set a colour per outcome and lets them leave it
 * null, so a catalog from there can arrive with gaps. Cycling a fixed list by
 * position keeps them distinguishable and stable for a given catalog, which is
 * what a map legend needs. Grey would be correct and useless: every custom
 * outcome would look like every other one.
 */
export const FALLBACK_HEX = [
  '#f472b6',
  '#22d3ee',
  '#facc15',
  '#a3e635',
  '#c084fc',
  '#fb923c',
] as const;

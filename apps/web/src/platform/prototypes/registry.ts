// The mobile apps being built, and the screen sizes they are looked at on.
//
// A registry rather than an API: every fact here is decided at build time and
// already lives in the repo. Adding an app is adding an entry, and its card,
// its preview link and its status all follow.
//
// Keep `blockers` honest. The whole value of the page is being able to look
// at it and know what is actually left, so an app that claims to be ready and
// is not costs more than one that admits what it is waiting on.

export type PrototypeStatus = 'building' | 'ready' | 'submitted' | 'live';

export interface Prototype {
  id: string;
  /** What it is called on a home screen. */
  name: string;
  client: string;
  /** One line, in the words of the person who uses it. */
  what: string;
  version: string;
  stores: Array<'ios' | 'android'>;
  status: PrototypeStatus;
  /** The route inside this app that the preview frames. */
  target: string;
  /** Where it lives, so a card leads somewhere in the repo too. */
  source: string;
  /** What still has to happen before a rep can install it. */
  blockers: string[];
}

export const STATUS_LABEL: Record<PrototypeStatus, string> = {
  building: 'In build',
  ready: 'Ready to submit',
  submitted: 'In review',
  live: 'On the stores',
};

export const PROTOTYPES: Prototype[] = [
  {
    id: 'all-star-field',
    name: 'All Star Field',
    client: 'All Star',
    what: 'Log every door in seconds, with or without a signal',
    version: '1.0.0',
    stores: ['ios', 'android'],
    status: 'building',
    target: '/field',
    source: 'apps/web/src/field',
    blockers: [
      'The knock form and the day tally: sign in and Today are the only screens so far',
      'Apple and Google developer accounts, which take days to verify',
      'An Android upload keystore',
      'The privacy policy hosted at a public URL',
      'A demo rep account, which Apple will not review without',
      'Screenshots from a real device',
    ],
  },
];

export function prototypeById(id: string): Prototype | undefined {
  return PROTOTYPES.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Screen sizes
// ---------------------------------------------------------------------------

export interface DeviceSize {
  id: string;
  name: string;
  platform: 'iOS' | 'Android' | 'Web';
  detail: string;
  width: number;
  height: number;
  /** Which frame is drawn. An Android phone is squarer than an iPhone. */
  shell: 'ios' | 'android' | 'tablet' | 'flat';
}

/**
 * Real sizes in CSS pixels, which is what the app's own layout responds to.
 *
 * Not round numbers: the point of checking a layout at 360px is that a rep
 * somewhere is holding a phone that is exactly 360px. Note the narrowest
 * screen here is a Samsung, not an iPhone. Android is the tighter constraint,
 * which is easy to get wrong by testing on an iPhone and assuming the rest
 * follows.
 */
export const DEVICE_SIZES: DeviceSize[] = [
  { id: 'se', name: 'iPhone SE', platform: 'iOS', detail: 'the smallest iPhone still in use', width: 375, height: 667, shell: 'ios' },
  { id: 'ip15', name: 'iPhone 15', platform: 'iOS', detail: 'what most iPhone reps will have', width: 393, height: 852, shell: 'ios' },
  { id: 'ipad', name: 'iPad mini', platform: 'iOS', detail: 'a manager reviewing on an iPad', width: 744, height: 1133, shell: 'tablet' },
  { id: 'galaxy', name: 'Galaxy S24', platform: 'Android', detail: 'the most common Android, and the narrowest screen here', width: 360, height: 780, shell: 'android' },
  { id: 'pixel', name: 'Pixel 8', platform: 'Android', detail: 'a wider Android', width: 412, height: 915, shell: 'android' },
  { id: 'tab', name: 'Galaxy Tab', platform: 'Android', detail: 'a manager reviewing on an Android tablet', width: 800, height: 1280, shell: 'tablet' },
  { id: 'desktop', name: 'Desktop', platform: 'Web', detail: 'the rep app in a laptop browser', width: 1280, height: 800, shell: 'flat' },
];

export const DEFAULT_DEVICE = DEVICE_SIZES[1]!;

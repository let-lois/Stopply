// The mobile apps being built, as the gallery at /prototypes reads them.
//
// A registry rather than an API: every fact here is decided at build time
// and lives in the repo already (bundle id, version, which stores it
// targets). Adding an app is adding an entry, and its card, its preview link
// and its status all follow.
//
// Keep `blockers` honest. The whole value of the page is being able to look
// at it and know what is actually left, so an app that says "ready" and is
// not costs more than one that admits what it is waiting on.

export type PrototypeStatus = 'building' | 'ready' | 'submitted' | 'live';

export interface Prototype {
  id: string;
  // What it is called on a home screen.
  name: string;
  // Whose app it is.
  client: string;
  // One line, in the words of the person who uses it, not the system.
  what: string;
  // Reverse domain id, permanent once a store has seen it.
  appId: string;
  version: string;
  stores: Array<'ios' | 'android'>;
  status: PrototypeStatus;
  // The test site for this app: device sizes, offline switch, fixture data.
  preview: string;
  // The same app with the page to itself, for a real phone or a screenshot.
  fullscreen: string;
  // Where it lives, so a card leads somewhere in the repo too.
  source: string;
  // What still has to happen before a rep can install it. Empty means
  // nothing does.
  blockers: string[];
  // Drives the card tint. Nothing but decoration; the text says everything
  // the colour hints at.
  tint: 'field' | 'ops';
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
    appId: 'com.letlois.allstarfield',
    version: '1.0.0',
    stores: ['ios', 'android'],
    status: 'ready',
    preview: '/field-preview',
    fullscreen: '/field-demo',
    source: 'apps/field-app',
    blockers: [
      'Apple and Google developer accounts, which take days to verify',
      'An Android upload keystore',
      'The privacy policy hosted at a public URL',
      'A demo rep account, which Apple will not review without',
      'Screenshots from a real device',
    ],
    tint: 'field',
  },
];

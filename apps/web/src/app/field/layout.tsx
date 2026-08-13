import type { Metadata } from 'next';

// Installable as a home screen app, so a rep taps one icon rather than
// finding a browser tab. Scoped to /field: installing the field app must
// not install the client's reporting dashboard alongside it.
export const metadata: Metadata = {
  title: 'Field Log',
  description: 'Log door to door activity from the field',
  manifest: '/field.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Field Log',
    statusBarStyle: 'default',
  },
};

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return children;
}

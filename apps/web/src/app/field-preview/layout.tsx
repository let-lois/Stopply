import type { Metadata } from 'next';

// Kept out of search results. This is an internal build surface, not
// something a client should find by looking for All Star.
export const metadata: Metadata = {
  title: 'All Star Field test site',
  description: 'The field app at phone, tablet and desktop sizes, with fixture data',
  robots: { index: false, follow: false },
};

export default function FieldPreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}

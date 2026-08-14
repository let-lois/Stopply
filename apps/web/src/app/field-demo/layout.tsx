import type { Metadata } from 'next';

// Kept out of search results. This is an internal build surface, not
// something a client should find by looking for All Star.
export const metadata: Metadata = {
  title: 'All Star Field demo',
  robots: { index: false, follow: false },
};

export default function FieldDemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}

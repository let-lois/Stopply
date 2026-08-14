import type { Metadata } from 'next';

// Kept out of search results. This is an internal build surface: it names
// clients and says what is unfinished, neither of which belongs in a search
// result.
export const metadata: Metadata = {
  title: 'Prototypes',
  description: 'The mobile apps in build, each openable at phone, tablet and laptop size',
  robots: { index: false, follow: false },
};

export default function PrototypesLayout({ children }: { children: React.ReactNode }) {
  return children;
}

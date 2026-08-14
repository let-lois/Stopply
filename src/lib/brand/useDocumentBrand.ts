// The tab, which is part of "nowhere".
//
// A workspace can be perfectly white-labelled on screen and still say Stopply
// in the tab title and show the Stopply mark in the tab strip, which is where
// a client's eye goes when they have six tabs open. The title and the favicon
// are the two pieces of chrome React does not own, so they are set here.

import { useEffect } from 'react';
import { monogram, monogramColor } from '@/lib/brand/logo';
import type { Brand } from '@/lib/brand/useBrand';

/** Put back on the way out, so the login page is not left wearing a client. */
const AGENCY_TITLE = 'Stopply';
const AGENCY_ICON = '/icon-192.png';

function setIcon(href: string): void {
  // Every icon link, not the first: index.html declares a 32px and a 192px,
  // and leaving one of them pointing at the Stopply mark means the browser is
  // free to pick that one.
  const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
  for (const link of links) link.href = href;
}

/**
 * The monogram as a favicon.
 *
 * Drawn rather than shipped, for the same reason the on-screen monogram is:
 * a client that has uploaded nothing still gets a mark of their own. Without
 * this the fallback would be the Stopply icon, and the tab strip is exactly
 * where that would be noticed.
 *
 * Returns null where there is no canvas, which is the test environment;
 * callers keep the current icon rather than failing.
 */
function monogramIcon(brand: Brand): string | null {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Rounded rather than square, to match the on-screen mark. A favicon is
  // small enough that the radius is most of what makes it recognisable.
  const r = size * 0.22;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.fillStyle = monogramColor(brand.key);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(size * 0.44)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Nudged down: textBaseline 'middle' sits on the em box rather than on the
  // cap height, which reads as high for capitals.
  ctx.fillText(monogram(brand.name), size / 2, size / 2 + size * 0.03);

  return canvas.toDataURL('image/png');
}

/** Make the tab match the brand. */
export function useDocumentBrand(brand: Brand): void {
  useEffect(() => {
    document.title = brand.name || AGENCY_TITLE;

    if (brand.isAgency) {
      setIcon(AGENCY_ICON);
    } else {
      const icon = brand.logo ?? monogramIcon(brand);
      if (icon) setIcon(icon);
    }

    return () => {
      document.title = AGENCY_TITLE;
      setIcon(AGENCY_ICON);
    };
  }, [brand]);
}

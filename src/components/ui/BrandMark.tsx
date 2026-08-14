// A brand's mark, uploaded or generated.
//
// Every client has one from the moment they exist, because the fallback is
// derived rather than stored. A workspace that has not uploaded anything gets
// its initials on a colour of its own, which is a real mark rather than a
// placeholder box, and nobody has to do anything to get it.

import { monogram, monogramColor } from '@/lib/brand/logo';
import type { Brand } from '@/lib/brand/useBrand';

export interface BrandMarkProps {
  brand: Brand;
  /** Rendered pixel size. The image is square by contract. */
  size?: number;
}

export function BrandMark({ brand, size = 36 }: BrandMarkProps) {
  if (brand.logo) {
    return (
      <img
        src={brand.logo}
        // Decorative: every place this appears has the brand's name beside it,
        // so announcing it again is noise to a screen reader.
        alt=""
        width={size}
        height={size}
        // contain, not cover: a logo cropped to fill a square is a logo with
        // its edges cut off, and a client notices that on their own mark.
        className="shrink-0 rounded-lg object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-lg font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: monogramColor(brand.key),
        // Scaled off the box rather than fixed, so one component serves the
        // 36px header and the 64px settings preview.
        fontSize: Math.round(size * 0.4),
        letterSpacing: '0.02em',
      }}
    >
      {monogram(brand.name)}
    </span>
  );
}

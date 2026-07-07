'use client';

// Default LetLois "Bi" brand mark, shown top left whenever a client has
// not uploaded their own logo. A self contained, monochrome SVG so it
// stays crisp at any size and adapts to light or dark via currentColor
// without a binary asset. The eye over the "i" echoes the letlois.com
// brand.

export function LetLoisLogo({ height = 30, title = 'LetLois BI' }: { height?: number; title?: string }) {
  return (
    <span className="brand-logo" style={{ height }} aria-label={title}>
      <svg height={height} viewBox="0 0 150 56" role="img" aria-hidden="true" fill="none">
        {/* Bold "B" glyph. */}
        <text
          x="0"
          y="46"
          fontFamily="'Spline Sans', system-ui, sans-serif"
          fontWeight="800"
          fontSize="52"
          fill="currentColor"
        >
          B
        </text>
        {/* Sketchy eye accent, standing in for the dot of the "i". */}
        <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M96 16 C108 5, 130 5, 143 16 C130 27, 108 27, 96 16 Z" fill="none" />
          <circle cx="119.5" cy="16" r="6" fill="currentColor" stroke="none" />
        </g>
        {/* "i" stem to the right of the eye. */}
        <rect x="130" y="26" width="10" height="26" rx="5" fill="currentColor" />
      </svg>
    </span>
  );
}

'use client';

// Default LetLois "Bi" brand mark, shown top left whenever a client has
// not uploaded their own logo. A self contained SVG so it stays crisp at
// any size and adapts to light or dark without a binary asset. The eye
// over the "i" echoes the letlois.com brand.

export function LetLoisLogo({ height = 30, title = 'LetLois BI' }: { height?: number; title?: string }) {
  // Unique gradient id so multiple instances on a page do not collide.
  const gid = `llg-${Math.round(height)}`;
  return (
    <span className="brand-logo" style={{ height }} aria-label={title}>
      <svg height={height} viewBox="0 0 132 48" role="img" aria-hidden="true" fill="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1f7ae0" />
            <stop offset="1" stopColor="#4ba3e8" />
          </linearGradient>
        </defs>
        {/* Rounded badge holding the wordmark. */}
        <rect x="0" y="2" width="44" height="44" rx="12" fill={`url(#${gid})`} />
        <text
          x="22"
          y="34"
          textAnchor="middle"
          fontFamily="'Spline Sans', system-ui, sans-serif"
          fontWeight="800"
          fontSize="26"
          fill="#ffffff"
        >
          Bi
        </text>
        {/* Sketchy eye accent. */}
        <g stroke="#1f7ae0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M58 18 C70 8, 90 8, 102 18 C90 28, 70 28, 58 18 Z" fill="none" />
          <circle cx="80" cy="18" r="5.5" fill="#1f7ae0" stroke="none" />
        </g>
        {/* "i" stem to the right of the eye. */}
        <rect x="112" y="14" width="9" height="24" rx="4.5" fill="currentColor" />
      </svg>
    </span>
  );
}

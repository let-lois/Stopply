'use client';

// Stopply brand mark, shown top left whenever a client has not uploaded
// their own logo. Sourced from the wordmark asset in public/ (background
// stripped to transparent), not a self contained SVG like the old LetLois
// mark was, so it does not adapt to theme via currentColor. In dark mode
// globals.css gives .brand-logo a light backing plate instead, see the
// comment there.

export function StopplyLogo({ height = 30, title = 'Stopply' }: { height?: number; title?: string }) {
  return (
    <span className="brand-logo" style={{ height }}>
      <img
        src="/stopply-logo-wordmark.png"
        alt={title}
        height={height}
        style={{ height, width: 'auto', display: 'block' }}
      />
    </span>
  );
}

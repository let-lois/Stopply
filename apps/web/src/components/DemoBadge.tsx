'use client';

// Badge shown only in preview demo mode (see lib/demoMode.ts), so a preview
// is never mistaken for the real dashboard. Default is a fixed corner badge
// (used on the login screen, which has empty space there). `inline` renders
// it in normal document flow instead, for the dashboard shell, where a fixed
// overlay would sit on top of in-page controls like the "New client" button.
export function DemoBadge({ inline }: { inline?: boolean } = {}) {
  return (
    <div className={`demo-badge${inline ? ' inline' : ''}`} role="status">
      Preview &middot; demo data
    </div>
  );
}

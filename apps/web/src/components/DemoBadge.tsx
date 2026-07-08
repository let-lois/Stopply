'use client';

// Small fixed badge shown only in preview demo mode (see lib/demoMode.ts),
// so a preview is never mistaken for the real dashboard.

export function DemoBadge() {
  return (
    <div className="demo-badge" role="status">
      Preview &middot; demo data
    </div>
  );
}

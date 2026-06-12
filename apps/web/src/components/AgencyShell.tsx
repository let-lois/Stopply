'use client';

// The agency console shell on bi.letlois.com: the top navigation menu,
// section switching, and sign out. Mirrors the tenant AppShell topbar
// (sticky header, desktop tabs, mobile hamburger) so the two planes feel
// like one product. Admins manage clients, their team, and the audit log;
// staff see only the clients assigned to them.

import { useState } from 'react';
import { ClientsSection, TeamSection, AuditSection } from './AgencyOverview';

type Section = 'clients' | 'team' | 'audit';

export function AgencyShell({
  role,
  userId,
  onEnterTenant,
  onLogout,
}: {
  role: 'agency_admin' | 'agency_staff';
  userId: string;
  onEnterTenant: (tenant: { id: string; slug: string; name: string }) => void;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<Section>('clients');
  const [menuOpen, setMenuOpen] = useState(false);

  // Team and the audit log are agency_admin only, matching the API's
  // requireRole gates; staff get the Clients view alone.
  const sections: Array<{ key: Section; label: string }> =
    role === 'agency_admin'
      ? [
          { key: 'clients', label: 'Clients' },
          { key: 'team', label: 'Team' },
          { key: 'audit', label: 'Audit log' },
        ]
      : [{ key: 'clients', label: 'Clients' }];

  const active = sections.some((s) => s.key === section) ? section : 'clients';

  const navItems = (onPick?: () => void, extraClass = '') =>
    sections.map((s) => (
      <button
        key={s.key}
        className={`${extraClass} ${s.key === active ? 'active' : ''}`.trim()}
        onClick={() => {
          setSection(s.key);
          onPick?.();
        }}
      >
        {s.label}
      </button>
    ));

  return (
    <div>
      <header className="topbar">
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>LetLois BI</strong>

        <nav className="tabs desktop" style={{ flex: 1 }}>
          {navItems()}
        </nav>

        <span className="muted" style={{ fontSize: 13 }}>
          {userId}
        </span>

        <button className="hamburger small" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
          ☰
        </button>
        <button className="small" onClick={onLogout}>
          Sign out
        </button>
      </header>

      {menuOpen && (
        <nav
          className="tabs stack"
          style={{ padding: 12, background: 'var(--card)', borderBottom: '1px solid var(--hairline)' }}
        >
          {navItems(() => setMenuOpen(false), 'cta')}
        </nav>
      )}

      <main className="shell">
        {active === 'clients' && <ClientsSection role={role} onEnterTenant={onEnterTenant} />}
        {active === 'team' && role === 'agency_admin' && <TeamSection currentUserId={userId} />}
        {active === 'audit' && role === 'agency_admin' && <AuditSection />}
      </main>
    </div>
  );
}

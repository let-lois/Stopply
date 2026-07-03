'use client';

// The agency console shell on bi.letlois.com: the left sidebar nav,
// section switching, and sign out. Mirrors the tenant AppShell sidebar
// (sticky, collapses to a hamburger drawer on mobile) so the two planes
// feel like one product. Admins manage clients, their team, and the audit
// log; staff see only the clients assigned to them.

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

  const navItems = (onPick?: () => void) =>
    sections.map((s) => (
      <button
        key={s.key}
        className={s.key === active ? 'active' : ''}
        onClick={() => {
          setSection(s.key);
          onPick?.();
        }}
      >
        {s.label}
      </button>
    ));

  return (
    <div className="app-layout">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>LetLois BI</strong>
        </div>

        <nav className="sidebar-nav">{navItems(() => setMenuOpen(false))}</nav>

        <div className="sidebar-footer">
          <span className="muted" style={{ fontSize: 13, padding: '0 12px' }}>
            {userId}
          </span>
          <button className="small" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>

      {menuOpen && <div className="sidebar-overlay open" onClick={() => setMenuOpen(false)} />}

      <div className="main-area">
        <header className="content-topbar">
          <button className="hamburger small" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
            {sections.find((s) => s.key === active)?.label}
          </strong>
        </header>

        <main className="shell">
          {active === 'clients' && <ClientsSection role={role} onEnterTenant={onEnterTenant} />}
          {active === 'team' && role === 'agency_admin' && <TeamSection currentUserId={userId} />}
          {active === 'audit' && role === 'agency_admin' && <AuditSection />}
        </main>
      </div>
    </div>
  );
}

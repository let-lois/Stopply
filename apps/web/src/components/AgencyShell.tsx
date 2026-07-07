'use client';

// The agency console shell on bi.letlois.com: the left sidebar navigation,
// section switching, and sign out. Mirrors the tenant AppShell sidebar
// (brand + account switcher up top, section links, mobile drawer) so the
// two planes feel like one product. Admins manage clients, their team, and
// the audit log; staff see only the clients assigned to them.

import { useEffect, useState } from 'react';
import { ClientsSection, TeamSection, AuditSection, SecretsSection } from './AgencyOverview';
import { LetLoisLogo } from './LetLoisLogo';
import { AccountSwitcher } from './AccountSwitcher';
import { ProfileMenu } from './ProfileMenu';
import { Sidebar } from './Sidebar';

type Section = 'clients' | 'team' | 'audit' | 'secrets';

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
  const [canSecrets, setCanSecrets] = useState(false);

  // Staff may have been granted the manageSecrets permission. We probe the
  // endpoint rather than threading the flag through the session: a 200 means
  // this user is allowed to see the keys & secrets console.
  useEffect(() => {
    import('@/lib/api').then(({ api }) =>
      api('/api/agency/secrets')
        .then(() => setCanSecrets(true))
        .catch(() => setCanSecrets(false))
    );
  }, []);

  // Team and the audit log are agency_admin only, matching the API's
  // requireRole gates; staff get the Clients view alone (plus the secrets
  // console if they have been granted that permission).
  const sections: Array<{ key: Section; label: string }> = [
    { key: 'clients', label: 'Clients' },
    ...(role === 'agency_admin'
      ? ([
          { key: 'team', label: 'Team' },
          { key: 'audit', label: 'Audit log' },
        ] as Array<{ key: Section; label: string }>)
      : []),
    ...(canSecrets ? ([{ key: 'secrets', label: 'Keys & secrets' }] as Array<{ key: Section; label: string }>) : []),
  ];

  const active = sections.some((s) => s.key === section) ? section : 'clients';

  return (
    <div className="app-layout">
      <Sidebar
        brand={
          // Agency console: the LetLois mark plus the account switcher,
          // which here sits in agency view and can drop into any sub-account.
          <>
            <LetLoisLogo />
            <AccountSwitcher current={null} onSwitchTenant={onEnterTenant} onEnterAgencyView={null} />
          </>
        }
        items={sections.map((s) => ({
          key: s.key,
          label: s.label,
          active: s.key === active,
          onClick: () => setSection(s.key),
        }))}
        footer={<ProfileMenu onLogout={onLogout} />}
        mobileOpen={menuOpen}
        onMobileOpenChange={setMenuOpen}
      />

      <main className="main-content shell">
        {active === 'clients' && <ClientsSection role={role} onEnterTenant={onEnterTenant} />}
        {active === 'team' && role === 'agency_admin' && <TeamSection currentUserId={userId} />}
        {active === 'audit' && role === 'agency_admin' && <AuditSection />}
        {active === 'secrets' && <SecretsSection />}
      </main>
    </div>
  );
}

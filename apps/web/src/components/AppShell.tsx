'use client';

// The tenant dashboard shell: theming from theme_json, tabs gated by role
// and view config, the comparison selector, the agency banner, mobile
// hamburger nav, footer credit, and the onboarding checklist for fresh
// tenants.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { isDemoMode, shouldShowDemoBadge } from '@/lib/demoMode';
import { getActiveDemoClientLogoUrl } from '@/lib/demoData';
import type { Comparison, SourceInfo, TenantSettings } from '@/lib/types';
import { DEFAULT_LABELS } from '@/lib/types';
import { PerformanceTab } from './tabs/Performance';
import { WorkBackwardsTab } from './tabs/WorkBackwards';
import { PlanningTab } from './tabs/Planning';
import { PresentTab } from './tabs/Present';
import { DataTeamTab } from './tabs/DataTeam';
import { ChatWidget } from './ChatWidget';
import { StopplyLogo } from './StopplyLogo';
import { DemoBadge } from './DemoBadge';
import { ClientsSection, TeamSection, AuditSection, SecretsSection } from './AgencyOverview';
import { MasterDateBar } from './MasterDateBar';
import { ProfileMenu } from './ProfileMenu';
import { CodeBox } from './CodeBox';
import { Sidebar } from './Sidebar';

const TOKEN_TO_VAR: Record<string, string> = {
  paper: '--paper',
  card: '--card',
  ink: '--ink',
  inkSoft: '--ink-soft',
  hairline: '--hairline',
  accent: '--accent',
  accentSoft: '--accent-soft',
  positive: '--positive',
  negative: '--negative',
  amber: '--amber',
  verifiedGreen: '--verified-green',
  grayCheck: '--gray-check',
  redCheck: '--red-check',
  channelGoogle: '--ch-google',
  channelMeta: '--ch-meta',
  channelWebsite: '--ch-website',
};

// Brand marks for the Meta and Google Ads tabs/headings, so the two
// platforms read apart from each other at a glance instead of just by
// label text.
const CHANNEL_LOGO: Record<'meta' | 'google', string> = {
  meta: '/channel-logos/meta.webp',
  google: '/channel-logos/google-ads.webp',
};

function ChannelLogo({ channel, size = 16 }: { channel: 'meta' | 'google'; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={CHANNEL_LOGO[channel]} alt="" height={size} style={{ height: size, width: 'auto' }} />
  );
}

// Agency console views swap the whole main area (they are about the
// agency, not any one client). Client sections do NOT swap anything:
// a client's dashboard is one continuous page and the sidebar entries
// for these just scroll to the matching section on it.
type ConsoleKey = 'clients' | 'team' | 'audit' | 'secrets';
type SectionKey = 'performance' | 'meta' | 'google' | 'work-backwards' | 'planning' | 'present' | 'data-team';
type TabKey = ConsoleKey | SectionKey;

// KPIs and Goals are hidden from the nav for now (too much noise on top
// of the Main Dashboard); their sections and route keys still exist so
// they are one line to bring back. Meta and Google are each their own
// section (not folded into Main Dashboard's Campaigns and ads) so a
// channel's full campaign/ad breakdown has its own page instead of
// competing with the other channel's for space; Main Dashboard is just
// the combined recap.
const CLIENT_SECTIONS: SectionKey[] = ['performance', 'meta', 'google', 'present', 'data-team'];

// Sections the client never presents from: agency working areas. They
// group to the right side of the profile nav under an Internal label.
const INTERNAL_SECTIONS: SectionKey[] = ['present', 'data-team'];

const isConsoleKey = (t: TabKey): t is ConsoleKey =>
  t === 'clients' || t === 'team' || t === 'audit' || t === 'secrets';

export function AppShell({
  isAgencyUser,
  agencyRole,
  userId,
  hasTenant,
  onSwitchTenant,
  onExitTenant,
  onLogout,
  initialTab,
}: {
  isAgencyUser: boolean;
  // Needed for the Clients tab: agency_admin sees "New client" and roster
  // controls that agency_staff does not, and gates the Team/Audit tabs.
  agencyRole?: 'agency_admin' | 'agency_staff';
  // Needed for the Team tab, to mark the signed in user's own row.
  userId: string;
  // False only for an agency user who has not entered a specific client's
  // dashboard yet: no tenant is selected server side, so /api/tenant/*
  // routes are not reachable (the API returns "no tenant selected"). True
  // for tenant users always, for agency users once they switch into a
  // client, and always true in demo mode (it has a synthetic active
  // client). When false, this renders the agency console tabs only
  // (Clients / Team / Audit log / Keys and secrets), none of which are
  // tenant scoped.
  hasTenant: boolean;
  onSwitchTenant: ((tenant: { id: string; slug: string; name: string }) => void) | null;
  // Closes the open client profile and returns to the Clients list.
  onExitTenant?: (() => void) | null;
  onLogout: () => void;
  initialTab?: TabKey;
}) {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  // Master date range: shared across Performance, WorkBackwards, Present,
  // and Planning, so switching the period once affects the whole client
  // dashboard instead of picking a month separately in every section.
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [sources, setSources] = useState<SourceInfo[]>([]);
  // Which agency console view is showing, or null for the client's own
  // one-page dashboard. Tenant users are always on the client page.
  const [consoleView, setConsoleView] = useState<ConsoleKey | null>(
    initialTab && isConsoleKey(initialTab) ? initialTab : hasTenant ? null : 'clients'
  );
  // Which section of the one-page client dashboard is in view (scroll spy),
  // purely for highlighting the sidebar link.
  const [activeSection, setActiveSection] = useState<SectionKey>('performance');
  // Which internal section is showing as its own view, or null for the
  // client-facing one-page dashboard. Internal areas (Present, Data and
  // Team) never share the page with what the client sees.
  const [internalView, setInternalView] = useState<SectionKey | null>(null);
  // Period-over-period comparison basis for the Main Dashboard, set once
  // in the sticky header and shared with PerformanceTab below.
  const [comparison, setComparison] = useState<Comparison>('previous');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasLogo, setHasLogo] = useState(false);
  const [logoSrc, setLogoSrc] = useState('/api/tenant/logo');
  const [error, setError] = useState<string | null>(null);
  const [canSecrets, setCanSecrets] = useState(false);

  // Scroll the one-page dashboard to a client-facing section. If a console
  // or internal view is currently showing, the section is not mounted yet,
  // so the scroll waits for the next paint after switching back.
  const scrollToSection = useCallback((key: SectionKey) => {
    setConsoleView(null);
    setInternalView(null);
    setActiveSection(key);
    requestAnimationFrame(() => {
      document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Open an internal section as its own view, replacing the client page.
  const openInternal = useCallback((key: SectionKey) => {
    setConsoleView(null);
    setInternalView(key);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }, []);

  const loadSettings = useCallback(() => {
    api<TenantSettings>('/api/tenant/settings')
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'));
  }, []);

  const loadSources = useCallback(() => {
    api<{ sources: SourceInfo[] }>('/api/tenant/sources')
      .then((r) => setSources(r.sources))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasTenant) return;
    loadSettings();
    loadSources();
    api<{ months: string[] }>('/api/tenant/months')
      .then((r) => {
        setMonths(r.months);
        if (r.months[0]) {
          setRangeStart(r.months[0]);
          setRangeEnd(r.months[0]);
        }
      })
      .catch(() => undefined);
    // Demo mode never touches the network. Demo clients that have a demo
    // logo asset configured (see demoData.ts) show it in the client
    // profile header via a static path instead of the real per-tenant
    // logo endpoint. This only ever feeds the profile header, never the
    // left agency sidebar, which always shows Stopply's own mark.
    if (isDemoMode()) {
      const demoLogo = getActiveDemoClientLogoUrl();
      if (demoLogo) {
        setLogoSrc(demoLogo);
        setHasLogo(true);
      } else {
        setHasLogo(false);
      }
    } else {
      fetch('/api/tenant/logo', { method: 'HEAD' }).then((r) => setHasLogo(r.ok)).catch(() => undefined);
    }
  }, [hasTenant, loadSettings, loadSources]);

  // Agency staff may have been granted the manageSecrets permission. We
  // probe the endpoint rather than threading the flag through the session:
  // a 200 means this user is allowed to see the keys & secrets console.
  useEffect(() => {
    if (!isAgencyUser) return;
    api('/api/agency/secrets')
      .then(() => setCanSecrets(true))
      .catch(() => setCanSecrets(false));
  }, [isAgencyUser]);

  // Scroll spy for the one-page dashboard: highlight the sidebar link of
  // whichever section currently crosses the upper part of the viewport.
  useEffect(() => {
    if (consoleView !== null || internalView !== null || !settings) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id.replace('section-', '') as SectionKey);
          }
        }
      },
      // A section counts as "active" while it crosses a band near the top
      // of the viewport, so the highlight follows reading position.
      { rootMargin: '-15% 0px -75% 0px' }
    );
    for (const key of CLIENT_SECTIONS) {
      if (INTERNAL_SECTIONS.includes(key)) continue;
      const el = document.getElementById(`section-${key}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [consoleView, internalView, settings]);

  // Apply the tenant theme as CSS variables on the app container.
  const themeStyle = useMemo(() => {
    const style: Record<string, string> = {};
    const theme = settings?.tenant.theme ?? {};
    for (const [token, cssVar] of Object.entries(TOKEN_TO_VAR)) {
      if (theme[token]) style[cssVar] = theme[token]!;
    }
    if (theme.fontDisplay) style['--font-display'] = `'${theme.fontDisplay}', serif`;
    if (theme.fontBody) style['--font-body'] = `'${theme.fontBody}', sans-serif`;
    if (theme.fontMono) style['--font-mono'] = `'${theme.fontMono}', monospace`;
    return style as React.CSSProperties;
  }, [settings]);

  if (hasTenant && error) {
    return (
      <div className="shell">
        <div className="card stack">
          <p className="delta-down">{error}</p>
          <button onClick={onLogout}>Sign out</button>
        </div>
      </div>
    );
  }

  if (hasTenant && !settings) {
    return (
      <div className="shell stack">
        <div className="skeleton" style={{ minHeight: 50 }} />
        <div className="skeleton" style={{ minHeight: 200 }} />
      </div>
    );
  }

  const labels = settings?.tenant.funnelLabels ?? DEFAULT_LABELS;
  const isViewer = settings?.role === 'viewer';

  const consoleKeys: ConsoleKey[] = isAgencyUser
    ? [
        'clients',
        ...(agencyRole === 'agency_admin' ? (['team', 'audit'] as ConsoleKey[]) : []),
        ...(canSecrets ? (['secrets'] as ConsoleKey[]) : []),
      ]
    : [];

  // The sections of the one-page client dashboard this user may see, in
  // page order. Viewers get only what their view config grants.
  const sectionKeys: SectionKey[] = !hasTenant
    ? []
    : isViewer
      ? CLIENT_SECTIONS.filter((s) =>
          ((settings?.viewConfig?.tabs ?? ['performance']) as SectionKey[]).includes(s)
        ).filter((s) => s !== 'present' && s !== 'data-team')
      : CLIENT_SECTIONS;

  const staleCount = sources.filter((s) => s.freshness === 'red').length;

  const tabLabel: Record<TabKey, string> = {
    clients: 'Clients',
    team: 'Team',
    audit: 'Audit log',
    secrets: 'Keys & secrets',
    performance: 'Main Dashboard',
    meta: 'Meta',
    google: 'Google Ads',
    'work-backwards': 'KPIs',
    planning: 'Goals',
    present: 'Present',
    'data-team': 'Data and Team',
  };

  const activeConsole = consoleView && consoleKeys.includes(consoleView) ? consoleView : consoleView ? 'clients' : null;

  const showOnboarding = !!settings && months.length === 0 && !isViewer;

  return (
    <div style={themeStyle}>
      {settings?.tenant.theme?.customCss && (
        <style dangerouslySetInnerHTML={{ __html: `.tenant-app { ${''} } ${scopeCss(settings.tenant.theme.customCss)}` }} />
      )}
      <div className="tenant-app app-layout">
        <Sidebar
          brand={
            <>
              {/* Top of sidebar: always Stopply's own mark, this is the
                  agency's tool, not the client's. A client's own logo (when
                  they have one) shows in the client profile header instead,
                  right next to their name. Agency users switch between
                  clients via the Clients tab in the nav below, not a
                  dropdown here, one continuous nav instead of a separate
                  switcher context. */}
              <StopplyLogo height={95} />
              {/* Rendered in normal flow here (not a fixed corner overlay)
                  so it can never overlap in-page controls like the Clients
                  tab's "New client" button. */}
              {shouldShowDemoBadge() && <DemoBadge inline />}
            </>
          }
          items={[
            // Agency console views: swap the main area entirely. An open
            // client's section links live inside the profile's own header,
            // not here, so the sidebar stays purely agency-level. Clients
            // remains highlighted while a profile is open, that is the
            // area you are in.
            ...consoleKeys.map((t) => ({
              key: t,
              label: tabLabel[t],
              active: t === activeConsole || (t === 'clients' && activeConsole === null),
              onClick: () => setConsoleView(t),
            })),
            // Tenant users have no Clients list; their sections are the
            // top-level nav. Internal sections open as their own view,
            // client pages share the one-page dashboard.
            ...(!isAgencyUser
              ? sectionKeys.map((s) => ({
                  key: s,
                  label: tabLabel[s],
                  badge: s === 'data-team' ? staleCount : undefined,
                  active: INTERNAL_SECTIONS.includes(s)
                    ? internalView === s
                    : internalView === null && s === activeSection,
                  onClick: () => (INTERNAL_SECTIONS.includes(s) ? openInternal(s) : scrollToSection(s)),
                }))
              : []),
          ]}
          footer={<ProfileMenu onLogout={onLogout} />}
          mobileOpen={menuOpen}
          onMobileOpenChange={setMenuOpen}
        />

        <main
          className={`main-content shell stack ${isAgencyUser && activeConsole === null && settings ? 'has-profile-head' : ''}`.trim()}
          style={{ gap: 12 }}
        >
          {activeConsole === 'clients' && (
            // Switching a client re-renders AppShell fresh via the key prop
            // in page.tsx (agencyTenant.id changes), landing on the top of
            // that client's profile.
            <ClientsSection role={agencyRole ?? 'agency_staff'} onEnterTenant={(t) => onSwitchTenant?.(t)} />
          )}
          {activeConsole === 'team' && <TeamSection currentUserId={userId} />}
          {activeConsole === 'audit' && <AuditSection />}
          {activeConsole === 'secrets' && <SecretsSection />}

          {activeConsole === null && settings && (
            // The client's profile: every section on one continuous page,
            // in sidebar order, each anchored for the scroll links above.
            <>
              {/* Sticky header: the open client's identity and section nav
                  for agency users, plus the master date range and
                  comparison basis for everyone, pinned while scrolling the
                  long page. The sections belong to this profile, so their
                  nav lives here rather than in the agency sidebar. */}
              <div className="client-profile-head">
                {isAgencyUser && (
                  <>
                    <div className="row" style={{ gap: 10, flexWrap: 'wrap', width: '100%' }}>
                      {/* This client's own logo, when they have one. */}
                      {hasLogo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoSrc} alt="" style={{ height: 26, maxWidth: 120, objectFit: 'contain' }} />
                      )}
                      <span className="profile-name">{settings.tenant.name}</span>
                    </div>
                    {/* Client-facing pages on the left, agency working areas
                        grouped to the right under an Internal label. The two
                        groups are separate views: internal tabs replace the
                        client page entirely, client tabs bring it back. */}
                    <nav className="profile-nav" aria-label="Client sections">
                      {sectionKeys
                        .filter((s) => !INTERNAL_SECTIONS.includes(s))
                        .map((s) => (
                          <button
                            key={s}
                            className={internalView === null && s === activeSection ? 'active' : ''}
                            onClick={() => scrollToSection(s)}
                          >
                            {(s === 'meta' || s === 'google') && <ChannelLogo channel={s} size={14} />}
                            {tabLabel[s]}
                          </button>
                        ))}
                      {sectionKeys.some((s) => INTERNAL_SECTIONS.includes(s)) && (
                        <div className="profile-nav-internal">
                          <span className="profile-nav-internal-label">Internal</span>
                          {sectionKeys
                            .filter((s) => INTERNAL_SECTIONS.includes(s))
                            .map((s) => (
                              <button
                                key={s}
                                className={internalView === s ? 'active' : ''}
                                onClick={() => openInternal(s)}
                              >
                                {tabLabel[s]}
                                {s === 'data-team' && staleCount > 0 && <span className="badge">{staleCount}</span>}
                              </button>
                            ))}
                        </div>
                      )}
                    </nav>
                  </>
                )}

                {/* One master date range plus the comparison basis, shared
                    by every section below (and by Present, its own view)
                    instead of a picker per section. Data and Team is not
                    period scoped, so it gets none of this. */}
                {internalView !== 'data-team' && months.length > 0 && (
                  <div className="row date-controls" style={{ justifyContent: 'space-between' }}>
                    <MasterDateBar
                      months={months}
                      timezone={settings.tenant.timezone}
                      start={rangeStart || months[0]!}
                      end={rangeEnd || months[0]!}
                      onChange={(s, e) => {
                        setRangeStart(s);
                        setRangeEnd(e);
                      }}
                    />
                    <label className="row" style={{ gap: 8, width: 'auto' }}>
                      <span className="muted" style={{ fontSize: 13 }}>Compare</span>
                      <select
                        value={comparison}
                        onChange={(e) => setComparison(e.target.value as Comparison)}
                        aria-label="Comparison"
                        style={{ width: 'auto' }}
                      >
                        <option value="previous">vs previous period</option>
                        <option value="year">vs same period last year</option>
                        <option value="target">vs target</option>
                        <option value="none">no comparison</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>

              {showOnboarding && internalView === null && (
                <OnboardingChecklist sources={sources} onOpenDataTeam={() => openInternal('data-team')} />
              )}

              {/* The client-facing one-page dashboard. Internal sections
                  never render here; they replace it as their own view. */}
              {internalView === null && (
                <>
                  {sectionKeys.includes('performance') && (
                    <section id="section-performance" className="page-section stack" style={{ gap: 10 }}>
                      <h2 className="section-title">Main Dashboard</h2>
                      <PerformanceTab
                        settings={settings}
                        labels={labels}
                        months={months}
                        rangeStart={rangeStart || months[0] || ''}
                        rangeEnd={rangeEnd || months[0] || ''}
                        sources={sources}
                        comparison={comparison}
                        refreshSources={loadSources}
                        hideCampaigns
                      />
                    </section>
                  )}
                  {/* Meta and Google each get the same PerformanceTab, just
                      narrowed to their own channel via channelFilter, so
                      each platform's campaigns and ads live on its own page
                      instead of sharing space with the other's. */}
                  {sectionKeys.includes('meta') && (
                    <section id="section-meta" className="page-section stack" style={{ gap: 10 }}>
                      <h2 className="section-title row" style={{ gap: 10, width: 'auto' }}>
                        <ChannelLogo channel="meta" size={22} />
                        Meta
                      </h2>
                      <PerformanceTab
                        settings={settings}
                        labels={labels}
                        months={months}
                        rangeStart={rangeStart || months[0] || ''}
                        rangeEnd={rangeEnd || months[0] || ''}
                        sources={sources}
                        comparison={comparison}
                        refreshSources={loadSources}
                        channelFilter="meta"
                      />
                    </section>
                  )}
                  {sectionKeys.includes('google') && (
                    <section id="section-google" className="page-section stack" style={{ gap: 10 }}>
                      <h2 className="section-title row" style={{ gap: 10, width: 'auto' }}>
                        <ChannelLogo channel="google" size={22} />
                        Google Ads
                      </h2>
                      <PerformanceTab
                        settings={settings}
                        labels={labels}
                        months={months}
                        rangeStart={rangeStart || months[0] || ''}
                        rangeEnd={rangeEnd || months[0] || ''}
                        sources={sources}
                        comparison={comparison}
                        refreshSources={loadSources}
                        channelFilter="google"
                      />
                    </section>
                  )}
                  {/* WorkBackwards, Planning, and Present render their own h2
                      titles, so their sections add no heading of their own. */}
                  {sectionKeys.includes('work-backwards') && (
                    <section id="section-work-backwards" className="page-section stack" style={{ gap: 20 }}>
                      <WorkBackwardsTab
                        labels={labels}
                        months={months}
                        rangeStart={rangeStart || months[0] || ''}
                        rangeEnd={rangeEnd || months[0] || ''}
                      />
                    </section>
                  )}
                  {sectionKeys.includes('planning') && (
                    <section id="section-planning" className="page-section stack" style={{ gap: 20 }}>
                      <PlanningTab
                        settings={settings}
                        labels={labels}
                        months={months}
                        rangeEnd={rangeEnd || months[0] || ''}
                      />
                    </section>
                  )}
                </>
              )}

              {internalView === 'present' && !isViewer && (
                <section id="section-present" className="page-section stack" style={{ gap: 20 }}>
                  <PresentTab
                    settings={settings}
                    labels={labels}
                    months={months}
                    rangeStart={rangeStart || months[0] || ''}
                    rangeEnd={rangeEnd || months[0] || ''}
                  />
                </section>
              )}
              {internalView === 'data-team' && !isViewer && (
                <section id="section-data-team" className="page-section stack" style={{ gap: 20 }}>
                  <h2 className="section-title">Data and Team</h2>
                  <DataTeamTab
                    settings={settings}
                    labels={labels}
                    sources={sources}
                    refreshSources={loadSources}
                    refreshSettings={loadSettings}
                  />
                </section>
              )}

              {settings.tenant.footerCredit && <div className="footer-credit">Managed by Stopply</div>}
            </>
          )}
        </main>

        {settings && <ChatWidget settings={settings} currentTab={activeConsole ?? internalView ?? activeSection} />}
      </div>
    </div>
  );
}

// Client side scoping for the sanitized custom CSS: every selector gets
// prefixed with the tenant app container.
function scopeCss(css: string): string {
  return css.replace(/(^|\})\s*([^{}@]+)\s*\{/g, (match, brace, selector) => {
    const scoped = String(selector)
      .split(',')
      .map((s: string) => `.tenant-app ${s.trim()}`)
      .join(', ');
    return `${brace} ${scoped} {`;
  });
}

// The systems a new account can pick from. Everyone is different, so rather
// than assume a fixed integration list we let them choose what they use.
// For now every system imports via CSV, so each pick simply creates a CSV
// source pre-tagged with the right parser ('auto' lets the AI detect it).
const SYSTEM_PRESETS: Array<{ id: string; name: string; connectorType: string; note: string }> = [
  { id: 'ghl', name: 'Go High Level (GHL)', connectorType: 'ghl-contacts', note: 'Contacts / leads CSV export' },
  { id: 'google', name: 'Google Ads', connectorType: 'google-campaign', note: 'Campaign spend CSV' },
  { id: 'meta', name: 'Meta Ads', connectorType: 'meta-campaign', note: 'Campaign spend CSV' },
  { id: 'boulevard', name: 'Boulevard', connectorType: 'auto', note: 'Appointments / sales CSV' },
  { id: 'jobber', name: 'Jobber', connectorType: 'auto', note: 'Jobs / clients CSV' },
  { id: 'housecall', name: 'Housecall Pro', connectorType: 'auto', note: 'Jobs / invoices CSV' },
  { id: 'custom', name: 'Something else', connectorType: 'auto', note: 'Any CSV — we figure out the columns' },
];

function OnboardingChecklist({
  sources,
  onOpenDataTeam,
}: {
  sources: SourceInfo[];
  // Scrolls to the Data and Team section of the one-page dashboard.
  onOpenDataTeam: () => void;
}) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const anyImported = sources.some((s) => s.last_import_at);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addSources = async () => {
    setBusy(true);
    try {
      for (const id of selected) {
        const preset = SYSTEM_PRESETS.find((p) => p.id === id);
        if (!preset) continue;
        await api('/api/tenant/sources', {
          method: 'POST',
          json: { name: preset.name, connectorType: preset.connectorType },
        }).catch(() => undefined);
      }
      setAdded(true);
      onOpenDataTeam();
    } finally {
      setBusy(false);
    }
  };

  const items = [
    { label: 'Pick the systems you use (above) and add them as sources', done: sources.length > 0 || added },
    { label: 'Upload your first CSV', done: anyImported },
    { label: 'Set your funnel labels', done: false },
    { label: "Set this month's targets", done: false },
    { label: 'Invite your team', done: false },
  ];

  return (
    <div className="card stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h3>Welcome. Let&apos;s get your first data in.</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Which systems do you use? Pick any that apply. Everything imports by CSV for now, so you stay in
          control of your data — no API keys needed to get started.
        </p>
      </div>

      <div className="system-grid">
        {SYSTEM_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`system-tile ${selected.includes(p.id) ? 'selected' : ''}`.trim()}
            onClick={() => toggle(p.id)}
          >
            <span className="system-name">
              {selected.includes(p.id) ? '☑ ' : '☐ '}
              {p.name}
            </span>
            <span className="system-note">{p.note}</span>
          </button>
        ))}
      </div>

      <div className="row">
        <button className="primary" disabled={busy || selected.length === 0} onClick={addSources}>
          {busy ? 'Adding…' : `Add ${selected.length || ''} as CSV source${selected.length === 1 ? '' : 's'}`}
        </button>
        <button className="small" onClick={() => onOpenDataTeam()}>
          Skip — set up sources myself
        </button>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Optional: install the website tracking script to attribute web visits.
        </span>
        <CodeBox
          label="Website tracking script"
          hint="Optional — paste into your site, or hand to your developer."
          code={`<script async src="${origin}/t.js"></script>`}
          language="html"
        />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {items.map((item) => (
          <div key={item.label} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              {item.done ? '✓ ' : '○ '}
              {item.label}
            </span>
            {!item.done && (
              <button className="small" onClick={() => onOpenDataTeam()}>
                Open Data and Team
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

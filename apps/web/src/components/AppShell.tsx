'use client';

// The tenant dashboard shell: theming from theme_json, tabs gated by role
// and view config, the comparison selector, the agency banner, mobile
// hamburger nav, footer credit, and the onboarding checklist for fresh
// tenants.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Comparison, SourceInfo, TenantSettings } from '@/lib/types';
import { DEFAULT_LABELS } from '@/lib/types';
import { PerformanceTab } from './tabs/Performance';
import { WorkBackwardsTab } from './tabs/WorkBackwards';
import { PlanningTab } from './tabs/Planning';
import { PresentTab } from './tabs/Present';
import { DataTeamTab } from './tabs/DataTeam';
import { ChatWidget } from './ChatWidget';
import { LetLoisLogo } from './LetLoisLogo';
import { AccountSwitcher } from './AccountSwitcher';
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

type TabKey = 'performance' | 'work-backwards' | 'planning' | 'present' | 'data-team';

export function AppShell({
  isAgencyUser,
  onExitTenant,
  onSwitchTenant,
  onLogout,
}: {
  isAgencyUser: boolean;
  onExitTenant: (() => void) | null;
  onSwitchTenant: ((tenant: { id: string; slug: string; name: string }) => void) | null;
  onLogout: () => void;
}) {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [tab, setTab] = useState<TabKey>('performance');
  const [comparison, setComparison] = useState<Comparison>('previous');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasLogo, setHasLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    loadSettings();
    loadSources();
    api<{ months: string[] }>('/api/tenant/months')
      .then((r) => setMonths(r.months))
      .catch(() => undefined);
    fetch('/api/tenant/logo', { method: 'HEAD' }).then((r) => setHasLogo(r.ok)).catch(() => undefined);
  }, [loadSettings, loadSources]);

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

  if (error) {
    return (
      <div className="shell">
        <div className="card stack">
          <p className="delta-down">{error}</p>
          <button onClick={onLogout}>Sign out</button>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="shell stack">
        <div className="skeleton" style={{ minHeight: 50 }} />
        <div className="skeleton" style={{ minHeight: 200 }} />
      </div>
    );
  }

  const labels = settings.tenant.funnelLabels ?? DEFAULT_LABELS;
  const isViewer = settings.role === 'viewer';
  const allowedTabs: TabKey[] = isViewer
    ? ((settings.viewConfig?.tabs ?? ['performance']) as TabKey[])
    : ['performance', 'work-backwards', 'planning', 'present', 'data-team'];

  const staleCount = sources.filter((s) => s.freshness === 'red').length;

  const tabLabel: Record<TabKey, string> = {
    performance: 'Performance',
    'work-backwards': 'Work Backwards',
    planning: 'Planning',
    present: 'Present',
    'data-team': 'Data and Team',
  };

  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0] ?? 'performance';

  const showOnboarding = months.length === 0 && !isViewer;

  return (
    <div style={themeStyle}>
      {settings.tenant.theme?.customCss && (
        <style dangerouslySetInnerHTML={{ __html: `.tenant-app { ${''} } ${scopeCss(settings.tenant.theme.customCss)}` }} />
      )}
      <div className="tenant-app app-layout">
        <Sidebar
          brand={
            // Top of sidebar: for agency users this is the account switcher
            // that tells you which sub-account you are in versus agency
            // view. For tenant users it is their logo, falling back to the
            // LetLois mark when no client logo has been uploaded.
            isAgencyUser ? (
              <AccountSwitcher
                current={{ id: settings.tenant.id, name: settings.tenant.name }}
                onSwitchTenant={(t) => onSwitchTenant?.(t)}
                onEnterAgencyView={onExitTenant}
              />
            ) : hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/tenant/logo" alt={settings.tenant.name} style={{ height: 32, maxWidth: 140, objectFit: 'contain' }} />
            ) : settings.tenant.theme?.wordmark ? (
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>
                {settings.tenant.theme.wordmark}
              </strong>
            ) : (
              <LetLoisLogo />
            )
          }
          items={allowedTabs.map((t) => ({
            key: t,
            label: tabLabel[t],
            badge: t === 'data-team' ? staleCount : undefined,
            active: t === activeTab,
            onClick: () => setTab(t),
          }))}
          footer={
            <>
              <select
                value={comparison}
                onChange={(e) => setComparison(e.target.value as Comparison)}
                aria-label="Comparison"
              >
                <option value="previous">vs previous month</option>
                <option value="year">vs same month last year</option>
                <option value="target">vs target</option>
                <option value="none">no comparison</option>
              </select>
              <ProfileMenu onLogout={onLogout} />
            </>
          }
          mobileOpen={menuOpen}
          onMobileOpenChange={setMenuOpen}
        />

        <main className="main-content shell stack" style={{ gap: 20 }}>
          {showOnboarding && <OnboardingChecklist sources={sources} onTabChange={setTab} />}
          {activeTab === 'performance' && (
            <PerformanceTab
              settings={settings}
              labels={labels}
              months={months}
              sources={sources}
              comparison={comparison}
              refreshSources={loadSources}
            />
          )}
          {activeTab === 'work-backwards' && <WorkBackwardsTab settings={settings} labels={labels} months={months} />}
          {activeTab === 'planning' && <PlanningTab settings={settings} labels={labels} months={months} />}
          {activeTab === 'present' && !isViewer && <PresentTab settings={settings} labels={labels} months={months} />}
          {activeTab === 'data-team' && !isViewer && (
            <DataTeamTab
              settings={settings}
              labels={labels}
              sources={sources}
              refreshSources={loadSources}
              refreshSettings={loadSettings}
            />
          )}

          {settings.tenant.footerCredit && <div className="footer-credit">Managed by LetLois</div>}
        </main>

        <ChatWidget settings={settings} currentTab={activeTab} />
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
  onTabChange,
}: {
  sources: SourceInfo[];
  onTabChange: (t: TabKey) => void;
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
      onTabChange('data-team');
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
        <button className="small" onClick={() => onTabChange('data-team')}>
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
              <button className="small" onClick={() => onTabChange('data-team')}>
                Open Data and Team
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

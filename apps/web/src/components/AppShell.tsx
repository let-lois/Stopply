'use client';

// The tenant dashboard shell: theming from theme_json, tabs gated by role
// and view config, the comparison selector, the agency banner, a left
// sidebar nav that collapses to a hamburger drawer on mobile, footer
// credit, and the onboarding checklist for fresh tenants.

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
  agencyContext,
  onExitTenant,
  onLogout,
}: {
  agencyContext: { name: string } | null;
  onExitTenant: (() => void) | null;
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
      <div className="tenant-app">
        {agencyContext && (
          <div style={{ background: 'var(--amber)', color: '#fff', textAlign: 'center', padding: '6px 12px', fontSize: 13 }}>
            Viewing {settings.tenant.name} as agency ({agencyContext.name}){' '}
            {onExitTenant && (
              <button className="small" style={{ marginLeft: 8, minHeight: 26 }} onClick={onExitTenant}>
                Back to overview
              </button>
            )}
          </div>
        )}

        <div className="app-layout">
          <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
            <div className="sidebar-brand">
              {hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/api/tenant/logo" alt={settings.tenant.name} style={{ height: 32, maxWidth: 140, objectFit: 'contain' }} />
              ) : (
                <strong style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>
                  {settings.tenant.theme?.wordmark || settings.tenant.name}
                </strong>
              )}
            </div>

            <nav className="sidebar-nav">
              {allowedTabs.map((t) => (
                <button
                  key={t}
                  className={t === activeTab ? 'active' : ''}
                  onClick={() => {
                    setTab(t);
                    setMenuOpen(false);
                  }}
                >
                  {tabLabel[t]}
                  {t === 'data-team' && staleCount > 0 && <span className="badge">{staleCount}</span>}
                </button>
              ))}
            </nav>

            <div className="sidebar-footer">
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
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{tabLabel[activeTab]}</strong>
            </header>

            <main className="shell stack" style={{ gap: 20 }}>
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
            </main>

            {settings.tenant.footerCredit && <div className="footer-credit">Managed by LetLois</div>}
          </div>
        </div>

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

function OnboardingChecklist({
  sources,
  onTabChange,
}: {
  sources: SourceInfo[];
  onTabChange: (t: TabKey) => void;
}) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const anyImported = sources.some((s) => s.last_import_at);
  const items = [
    {
      label: 'Install the tracking script',
      done: sources.some((s) => s.kind === 'pixel' && s.last_import_at),
      detail: (
        <code style={{ fontSize: 12 }}>{`<script async src="${origin}/t.js"></script>`}</code>
      ),
    },
    { label: 'Connect or upload your first source', done: anyImported, detail: null },
    { label: 'Set your funnel labels', done: false, detail: null },
    { label: "Set this month's targets", done: false, detail: null },
    { label: 'Invite your team', done: false, detail: null },
  ];
  return (
    <div className="card stack">
      <h3>Welcome. Let&apos;s get your first data in.</h3>
      {items.map((item) => (
        <div key={item.label} className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            {item.done ? '✓ ' : '○ '}
            {item.label}
            {item.detail && <div>{item.detail}</div>}
          </span>
          {!item.done && (
            <button className="small" onClick={() => onTabChange('data-team')}>
              Open Data and Team
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

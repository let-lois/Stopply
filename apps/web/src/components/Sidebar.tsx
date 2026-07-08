'use client';

// Shared left-hand navigation rail used by AppShell, for both the tenant
// dashboard and the agency console tabs. Mirrors the Claude.ai pattern: a fixed
// width column with the brand/account switcher up top, section links in the
// middle, and account controls pinned to the bottom. Collapses to an
// off-canvas drawer, opened by a hamburger button, below 900px.

export interface SidebarNavItem {
  key: string;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}

export function Sidebar({
  brand,
  items,
  footer,
  mobileOpen,
  onMobileOpenChange,
}: {
  brand: React.ReactNode;
  items: SidebarNavItem[];
  footer?: React.ReactNode;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <button className="sidebar-hamburger small" onClick={() => onMobileOpenChange(!mobileOpen)} aria-label="Menu">
        ☰
      </button>

      {mobileOpen && <div className="sidebar-backdrop" onClick={() => onMobileOpenChange(false)} />}

      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`.trim()}>
        <div className="sidebar-brand">{brand}</div>

        <nav className="sidebar-nav">
          {items.map((item) => (
            <button
              key={item.key}
              className={item.active ? 'active' : ''}
              onClick={() => {
                item.onClick();
                onMobileOpenChange(false);
              }}
            >
              <span>{item.label}</span>
              {!!item.badge && <span className="badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        {footer && <div className="sidebar-footer">{footer}</div>}
      </aside>
    </>
  );
}

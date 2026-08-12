/* Stopply theme diagnostic.
 *
 * Paste into the DevTools console while a client's dashboard is open and
 * looking wrong. Reports what the tenant actually stores and what the page
 * resolved, which separates the three things that look identical on screen:
 * a tenant palette applying, a tenant's custom CSS applying, and the fix
 * simply not being deployed yet.
 *
 * Reads only. Changes nothing.
 */
(async () => {
  const out = {};
  const root = document.documentElement;

  // Which build is serving this page. Without it, "the fix is not deployed"
  // and "the fix does not work" look the same from the outside.
  out.build = window.STOPPLY_BUILD ?? '(no build stamp: this bundle predates it)';

  out.mode = {
    dataThemeAttribute: root.getAttribute('data-theme') ?? '(not set)',
    localStorage: (() => {
      try {
        return localStorage.getItem('lbi-theme') ?? '(not set)';
      } catch {
        return '(unreadable)';
      }
    })(),
  };

  // Does the deployed bundle still apply tenant colors in dark mode? The fix
  // leaves the container with no inline custom properties when dark.
  const themed = document.querySelector('.tenant-app')?.parentElement ?? null;
  const inline = themed
    ? Array.from(themed.style).filter((p) => p.startsWith('--'))
    : [];
  out.container = {
    found: !!themed,
    hasTenantThemedClass: !!document.querySelector('.tenant-themed'),
    inlineCustomProperties: inline.length ? inline : '(none)',
  };

  const readVars = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const pick = {};
    for (const v of ['--paper', '--card', '--ink', '--ink-soft', '--sidebar-bg', '--accent']) {
      pick[v] = cs.getPropertyValue(v).trim();
    }
    return pick;
  };
  out.resolved = { root: readVars(root), container: readVars(themed) };

  // Tenant custom CSS is injected as a scoped <style> and can paint
  // backgrounds directly, bypassing the variables entirely.
  const styleTags = Array.from(document.querySelectorAll('style')).filter((s) =>
    s.textContent?.includes('.tenant-app ')
  );
  out.customCssInjected = styleTags.length > 0;
  if (styleTags.length) out.customCssSample = styleTags[0].textContent.slice(0, 400);

  try {
    const res = await fetch('/api/tenant/settings', { credentials: 'same-origin' });
    const body = await res.json();
    const theme = body?.tenant?.theme ?? null;
    out.storedTheme = theme
      ? {
          keys: Object.keys(theme).sort(),
          hasCustomCss: !!theme.customCss,
          paper: theme.paper ?? '(unset)',
          card: theme.card ?? '(unset)',
          ink: theme.ink ?? '(unset)',
          inkSoft: theme.inkSoft ?? '(unset)',
        }
      : null;
    out.tenant = { name: body?.tenant?.name, slug: body?.tenant?.slug, timezone: body?.tenant?.timezone };
  } catch (err) {
    out.storedTheme = 'could not read /api/tenant/settings: ' + err.message;
  }

  console.log('%c[theme diagnostic]', 'color:#8ab4f8;font-weight:bold');
  console.log(JSON.stringify(out, null, 2));
  console.log(
    '%cCopy the JSON above and send it over.',
    'color:#8ab4f8'
  );
})().catch((e) => console.error('[theme diagnostic] failed:', e));

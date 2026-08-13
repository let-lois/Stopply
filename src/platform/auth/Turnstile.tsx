// The Turnstile widget.
//
// Note where the security lives: not here. This renders a challenge and hands
// back a token, and if it fails to load it hands back nothing. The server
// refuses a request with no token, so a widget that never appears is a login
// that cannot proceed, which is the correct failure.
//
// That is why the "is a site key configured" branch below is safe while the
// server-side equivalent would not be. Skipping the widget does not skip the
// check; it just means the caller has nothing to present.

import { useEffect, useId, useRef } from 'react';

// Injected at build time from VITE_TURNSTILE_SITE_KEY. The site key is public
// by design; it appears in the page source of every site using Turnstile.
const SITE_KEY = import.meta.env['VITE_TURNSTILE_SITE_KEY'] as string | undefined;

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; 'error-callback': () => void }
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile could not be loaded'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const containerId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  // Kept in a ref rather than state: the callback identity must not change
  // between the render that mounts the widget and the one that tears it down.
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY) return;

    let widgetId: string | null = null;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onTokenRef.current(token),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (!SITE_KEY) {
    // Honest about what is missing, and specific enough to fix. The sign-in
    // button stays disabled, because the server will refuse without a token
    // whatever this component says.
    return (
      <p className="text-xs text-[var(--color-ink-faint)]">
        The sign-in challenge is not configured for this deployment, so signing in is unavailable.
        Set VITE_TURNSTILE_SITE_KEY at build time.
      </p>
    );
  }

  return <div id={containerId} ref={containerRef} />;
}

export const turnstileConfigured = Boolean(SITE_KEY);

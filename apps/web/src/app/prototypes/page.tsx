'use client';

// The prototype apps, in one place.
//
// Same job the Clients view does for clients: show what exists, say enough
// about each one to be useful at a glance, and click through into it. Here
// the thing you click through into is the app itself, running.
//
// Everything on this page is build time fact from lib/prototypes.ts. It
// reaches no API and shows no client data, which is why it can be a plain
// static route rather than something behind the dashboard's sign in.

import { PROTOTYPES, STATUS_LABEL, type Prototype } from '@/lib/prototypes';
import './prototypes.css';

function AppleMark() {
  return (
    <svg width="13" height="15" viewBox="0 0 14 16" fill="currentColor" aria-hidden="true">
      <path d="M11.3 8.5c0-1.7 1.4-2.5 1.5-2.6-.8-1.2-2.1-1.3-2.5-1.3-1.1-.1-2.1.6-2.6.6-.6 0-1.4-.6-2.3-.6-1.2 0-2.3.7-2.9 1.8-1.2 2.1-.3 5.3.9 7 .6.8 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.5c.9 0 1.5-.8 2.1-1.7.7-1 .9-1.9.9-2-.1 0-1.9-.7-1.9-2.9zM9.6 3.3c.5-.6.8-1.4.7-2.3-.7 0-1.6.5-2.1 1.1-.4.5-.8 1.4-.7 2.2.8.1 1.6-.4 2.1-1z" />
    </svg>
  );
}

function AndroidMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.7 5.3l1-1.7a.2.2 0 00-.35-.2l-1 1.75A4.9 4.9 0 008 4.7c-.5 0-1 .06-1.35.45L5.65 3.4a.2.2 0 00-.35.2l1 1.7A4 4 0 003.4 8.8h9.2a4 4 0 00-.9-3.5zM6 7.4a.5.5 0 110-1 .5.5 0 010 1zm4 0a.5.5 0 110-1 .5.5 0 010 1z" />
      <path d="M3.4 9.5v3.6c0 .5.4.9.9.9h.5v1.6a.9.9 0 001.8 0V14h2.8v1.6a.9.9 0 001.8 0V14h.5c.5 0 .9-.4.9-.9V9.5H3.4zM2.1 9.4a.9.9 0 00-.9.9v3a.9.9 0 001.8 0v-3a.9.9 0 00-.9-.9zM13.9 9.4a.9.9 0 00-.9.9v3a.9.9 0 001.8 0v-3a.9.9 0 00-.9-.9z" />
    </svg>
  );
}

// Green once nothing is in the way, amber while something is. Same
// vocabulary the dashboard's own status dots use.
function statusTone(app: Prototype): 'green' | 'amber' | 'gray' {
  if (app.status === 'live') return 'green';
  if (app.status === 'building') return 'gray';
  return app.blockers.length > 0 ? 'amber' : 'green';
}

export default function PrototypesPage() {
  const build = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev';
  const branch = process.env.NEXT_PUBLIC_BUILD_BRANCH ?? 'local';

  return (
    <div className="protos">
      <header className="protos-hero">
        <p className="protos-eyebrow">Prototypes</p>
        <h1>Mobile apps in build</h1>
        <p className="protos-lede">
          The apps being built for clients to install from the App Store and Play Store. Open one to
          use it at phone, tablet or laptop size. They run the real screens against stand-in data, so
          no sign in is needed and no client&apos;s data is reachable.
        </p>
      </header>

      <div className="proto-grid">
        {PROTOTYPES.map((app) => (
          <article key={app.id} className="proto-card" data-tint={app.tint}>
            <div className="proto-card-head">
              <span className={`proto-dot ${statusTone(app)}`} aria-hidden="true" />
              <div className="proto-card-title">
                <h2>{app.name}</h2>
                <p className="proto-card-client">
                  {app.client} · v{app.version}
                </p>
              </div>
              <span className="proto-status">{STATUS_LABEL[app.status]}</span>
            </div>

            <p className="proto-what">{app.what}</p>

            <dl className="proto-facts">
              <div>
                <dt>Stores</dt>
                <dd className="proto-stores">
                  {app.stores.includes('ios') && (
                    <span className="proto-store">
                      <AppleMark /> App Store
                    </span>
                  )}
                  {app.stores.includes('android') && (
                    <span className="proto-store">
                      <AndroidMark /> Play Store
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>App id</dt>
                <dd>
                  <code>{app.appId}</code>
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  <code>{app.source}</code>
                </dd>
              </div>
            </dl>

            {app.blockers.length > 0 && (
              <details className="proto-blockers">
                <summary>
                  {app.blockers.length} thing{app.blockers.length === 1 ? '' : 's'} left before it can
                  be downloaded
                </summary>
                <ul>
                  {app.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </details>
            )}

            {/* Both open a tab of their own, and that is load bearing, not
                a preference. The test site runs the app in an iframe, and
                an iframe whose page was reached by a same tab link from
                here never finishes hydrating, so the app comes up blank. A
                tab of its own always works, and opening a prototype beside
                the list rather than instead of it is the better behaviour
                anyway. Do not make these same tab links. */}
            <div className="proto-actions">
              <a className="proto-open" href={app.preview} target="_blank" rel="noreferrer">
                Open the app
              </a>
              <a className="proto-secondary" href={app.fullscreen} target="_blank" rel="noreferrer">
                Full window
              </a>
            </div>
          </article>
        ))}
      </div>

      <footer className="protos-foot">
        <span>
          Adding an app here is one entry in <code>apps/web/src/lib/prototypes.ts</code>.
        </span>
        <span className="protos-build">
          {branch} · {build}
        </span>
      </footer>
    </div>
  );
}

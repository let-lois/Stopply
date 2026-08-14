// The mobile apps in build, in one place.
//
// The same job the Clients page does for clients: show what exists, say
// enough about each one to be useful at a glance, and click through into it.
// Here the thing you click through into is the app itself, running.
//
// Everything here is build-time fact from registry.ts. It reaches no API and
// shows no client data, so nothing on this page depends on the workspace a
// person happens to have open.

import { Link } from 'react-router-dom';
import { Apple, Smartphone } from 'lucide-react';
import { PROTOTYPES, STATUS_LABEL, type Prototype } from '@/platform/prototypes/registry';
import { routes } from '@/types/routes';

// Amber while something is in the way, green once nothing is. The dot is not
// decoration: a row of these should be scannable without reading the labels.
function statusTone(app: Prototype): string {
  if (app.status === 'live') return 'bg-[var(--color-positive)]';
  if (app.blockers.length > 0) return 'bg-[var(--color-warning)]';
  return 'bg-[var(--color-positive)]';
}

function Card({ app }: { app: Prototype }) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface-raised p-6">
      <div className="flex items-start gap-3">
        <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${statusTone(app)}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">{app.name}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-soft)] tabular-nums">
            {app.client} · v{app.version}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink-soft)]">
          {STATUS_LABEL[app.status]}
        </span>
      </div>

      <p className="text-sm text-[var(--color-ink-soft)]">{app.what}</p>

      <dl className="flex flex-col text-sm">
        <div className="flex items-center gap-4 border-t border-hairline py-2.5">
          <dt className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]">
            Stores
          </dt>
          <dd className="flex flex-wrap gap-2">
            {app.stores.includes('ios') && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-xs">
                <Apple className="h-3.5 w-3.5" aria-hidden="true" /> App Store
              </span>
            )}
            {app.stores.includes('android') && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-xs">
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> Play Store
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-4 border-t border-hairline py-2.5">
          <dt className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]">
            Source
          </dt>
          <dd className="min-w-0 truncate font-mono text-xs text-[var(--color-ink-soft)]">
            {app.source}
          </dd>
        </div>
      </dl>

      {app.blockers.length > 0 && (
        // Folded away by default: the card should read as "here is the app",
        // with the caveats one click down rather than shouting over it.
        <details className="border-t border-hairline pt-3 text-sm">
          <summary className="cursor-pointer font-medium text-[var(--color-warning)]">
            {app.blockers.length} thing{app.blockers.length === 1 ? '' : 's'} left before it can be
            downloaded
          </summary>
          <ul className="mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-[var(--color-ink-soft)]">
            {app.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Link
          to={routes.prototype(app.id)}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)] transition hover:opacity-90"
        >
          Open the app
        </Link>
      </div>
    </article>
  );
}

export default function PrototypesPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-8">
      <header className="border-b border-hairline pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-soft)]">
          Prototypes
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)] md:text-3xl">
          Mobile apps in build
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          The apps being built for clients to install from the App Store and Play Store. Open one to
          use it at phone, tablet or laptop size. They run the real screens against stand-in data, so
          no sign in is needed and no client&rsquo;s data is reachable.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {PROTOTYPES.map((app) => (
          <Card key={app.id} app={app} />
        ))}
      </div>

      <p className="border-t border-hairline pt-4 text-xs text-[var(--color-ink-soft)]">
        Adding an app here is one entry in{' '}
        <span className="font-mono">apps/web/src/platform/prototypes/registry.ts</span>.
      </p>
    </div>
  );
}

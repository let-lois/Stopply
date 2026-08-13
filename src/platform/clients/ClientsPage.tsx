import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { MODULE_ORDER, MODULE_REGISTRY, defaultViewFor } from '@/modules/registry';
import { routes } from '@/types/routes';
import { Badge, Button, CardButton, EmptyState } from '@/components/ui';
import { NewClientDialog } from '@/platform/clients/NewClientDialog';
import { ClientConfigDialog } from '@/platform/clients/ClientConfigDialog';
import { useCan } from '@/lib/auth/useCan';
import { relativeTime } from '@/lib/format/datetime';
import { accentClasses } from '@/types/accent';

export default function ClientsPage() {
  const { clients } = usePlatform();
  const navigate = useNavigate();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  // The id, not the client object. Deriving it on render means the dialog
  // reflects a module toggled inside it, rather than the snapshot taken when
  // it opened.
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const configuring = clients.find((c) => c.id === configuringId) ?? null;

  // One implementation of "which view does this client land on", called from
  // one place. The prototype had the same six-branch chain here and in an
  // App effect; both ran on Open Workspace and the effect won, making this
  // one dead code that happened to agree.
  const open = (clientId: string, enabledModules: typeof clients[number]['enabledModules']) => {
    const target = defaultViewFor(enabledModules);
    void navigate(
      target ? routes.workspace(clientId, target.moduleId, target.viewId) : routes.workspaceSettings(clientId)
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="micro-label mt-1">{clients.length} workspaces</p>
        </div>
        {can('client.create') && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New client
          </Button>
        )}
      </div>

      {clients.length === 0 && (
        <EmptyState title="No clients yet" body="Create a client workspace to get started." />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => (
          <div key={client.id} className="flex flex-col gap-2">
          <CardButton
            label={`Open ${client.name}`}
            onClick={() => open(client.id, client.enabledModules)}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{client.name}</h2>
                <p className="text-sm text-[var(--color-ink-soft)]">{client.industry}</p>
              </div>
              <Badge accent={client.status === 'active' ? 'emerald' : 'amber'}>
                {client.status}
              </Badge>
            </div>

            {/* Colour and icon come from the registry. The prototype
                duplicated this as an inline ternary whose fallback gave
                analytics the wrong colour. */}
            <ul className="mt-4 flex flex-wrap gap-2">
              {MODULE_ORDER.filter((id) => client.enabledModules.includes(id)).map((id) => {
                const def = MODULE_REGISTRY[id];
                const a = accentClasses(def.accent);
                return (
                  <li
                    key={id}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${a.soft} ${a.text} ${a.border}`}
                  >
                    <def.Icon size={12} aria-hidden="true" />
                    {def.name}
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
              {client.plan} · active {relativeTime(client.lastActive)}
            </p>
          </CardButton>
          {can('client.configure', { clientId: client.id }) && (
            <Button className="self-start" onClick={() => setConfiguringId(client.id)}>
              Configure
            </Button>
          )}
          </div>
        ))}
      </div>

      {/* Both dialogs mount only while open, so neither can carry state into
          its next subject. The config dialog is additionally keyed by client,
          so switching client remounts it rather than reusing a tab position
          from the previous one. */}
      {creating && <NewClientDialog open onClose={() => setCreating(false)} />}
      {configuring && (
        <ClientConfigDialog
          key={configuring.id}
          client={configuring}
          open
          onClose={() => setConfiguringId(null)}
        />
      )}
    </div>
  );
}

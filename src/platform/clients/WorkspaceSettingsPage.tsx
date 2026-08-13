import { useParams } from 'react-router-dom';
import { usePlatform, usePlatformActions } from '@/lib/state/PlatformProvider';
import { MODULE_ORDER, MODULE_REGISTRY } from '@/modules/registry';
import { Card, Switch } from '@/components/ui';
import { NotFoundView } from '@/platform/routing/NotFoundView';
import { accentClasses } from '@/types/accent';

export default function WorkspaceSettingsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();
  const { setModuleEnabled, setClientDataMode } = usePlatformActions();
  const client = clients.find((c) => c.id === clientId);

  if (!client) {
    return <NotFoundView title="No such workspace" body="That client does not exist." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{client.name}</h1>
        <p className="micro-label mt-1">
          {client.plan} · {client.industry}
        </p>
      </div>

      <Card>
        <p className="micro-label mb-4">Modules</p>
        <div className="flex flex-col gap-4">
          {MODULE_ORDER.map((id) => {
            const def = MODULE_REGISTRY[id];
            const enabled = client.enabledModules.includes(id);
            return (
              <div key={id} className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <def.Icon
                    size={18}
                    className={`mt-0.5 ${accentClasses(def.accent).text}`}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-medium">{def.name}</p>
                    <p className="text-sm text-[var(--color-ink-soft)]">{def.description}</p>
                  </div>
                </div>
                <Switch
                  checked={enabled}
                  hideLabel
                  label={`${enabled ? 'Disable' : 'Enable'} ${def.name}`}
                  onChange={(next) => setModuleEnabled(client.id, id, next)}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <p className="micro-label mb-2">Data source</p>
        <p className="mb-4 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Demo mode generates consistent sample data for this workspace. Live mode
          requires a connected source, which is not available in this build; the
          modules will say so rather than showing demo numbers.
        </p>
        <Switch
          checked={client.dataMode === 'live'}
          label="Live mode"
          hint={client.dataMode === 'live' ? 'No live source is connected' : 'Showing demo data'}
          onChange={(next) => setClientDataMode(client.id, next ? 'live' : 'demo')}
        />
      </Card>
    </div>
  );
}

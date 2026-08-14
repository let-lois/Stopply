// Configure a client without leaving the clients list.
//
// Keyed by client id at the call site and mounted only while open, so it
// cannot carry state between subjects. The prototype's version kept its
// local tab in state across opens, so opening client B landed on whichever
// tab client A was left on, and it declared a 'details' tab in its state
// union that had no button and no panel.

import { useState } from 'react';
import type { Client, ModuleId } from '@/types';
import { usePlatformActions } from '@/lib/state/PlatformProvider';
import { MODULE_ORDER, MODULE_REGISTRY } from '@/modules/registry';
import { Button, Dialog, Switch } from '@/components/ui';
import { accentClasses } from '@/types/accent';
import { clientSubtitle } from '@/lib/format/clientSubtitle';

// Every tab here has a button and a panel. The union is the source of both.
const TABS = ['modules', 'data'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  modules: 'Modules',
  data: 'Data source',
};

export function ClientConfigDialog({
  client,
  open,
  onClose,
}: {
  client: Client;
  open: boolean;
  onClose: () => void;
}) {
  const { setModuleEnabled, setClientDataMode } = usePlatformActions();
  const [tab, setTab] = useState<Tab>('modules');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={client.name}
      description={clientSubtitle(client)}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-5">
        <div role="tablist" aria-label="Configuration" className="flex gap-2">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={[
                'rounded-xl px-3 py-2 text-sm transition',
                tab === id
                  ? 'bg-fill font-medium text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-soft)] hover:bg-fill-subtle',
              ].join(' ')}
            >
              {TAB_LABEL[id]}
            </button>
          ))}
        </div>

        {tab === 'modules' && (
          <div role="tabpanel" className="flex flex-col gap-4">
            {MODULE_ORDER.map((id: ModuleId) => {
              const def = MODULE_REGISTRY[id];
              const enabled = client.enabledModules.includes(id);
              return (
                <div key={id} className="flex items-start justify-between gap-4">
                  <span className="flex items-start gap-3">
                    <def.Icon
                      size={16}
                      className={`mt-1 ${accentClasses(def.accent).text}`}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-sm font-medium">{def.name}</span>
                      <span className="text-xs text-[var(--color-ink-faint)]">{def.tagline}</span>
                    </span>
                  </span>
                  <Switch
                    checked={enabled}
                    hideLabel
                    label={`${enabled ? 'Disable' : 'Enable'} ${def.name} for ${client.name}`}
                    onChange={(next) => void setModuleEnabled(client.id, id, next)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {tab === 'data' && (
          <div role="tabpanel" className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-ink-soft)]">
              Demo mode generates consistent sample data for this workspace. Live
              mode needs a connected source, which this build does not have, so the
              modules will say so rather than showing demo numbers behind a live
              label.
            </p>
            <Switch
              checked={client.dataMode === 'live'}
              label="Live mode"
              hint={
                client.dataMode === 'live' ? 'Reading from the server' : 'Showing demo data'
              }
              onChange={(next) => void setClientDataMode(client.id, next ? 'live' : 'demo')}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

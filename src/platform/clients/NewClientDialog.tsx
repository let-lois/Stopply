// Create a client workspace.
//
// Mounted only while open, so its state cannot survive a close. The
// prototype rendered both global dialogs unconditionally and let them hide
// themselves, so useState persisted across opens: its submit handler reset
// name, industry and contact fields but not selectedModules, dataMode or
// plan. Create a logistics-only client on Growth, reopen, and the form still
// showed logistics-only on Growth. The next client was then silently
// misconfigured by the previous one.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClientPlan, ModuleId } from '@/types';
import { usePlatformActions } from '@/lib/state/PlatformProvider';
import { MODULE_ORDER, MODULE_REGISTRY, defaultViewFor } from '@/modules/registry';
import { Button, Dialog, Switch } from '@/components/ui';
import { routes } from '@/types/routes';
import { accentClasses } from '@/types/accent';

const PLANS: ClientPlan[] = ['Growth', 'Pro', 'Enterprise'];

export function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createClient } = usePlatformActions();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [plan, setPlan] = useState<ClientPlan>('Growth');
  const [modules, setModules] = useState<ModuleId[]>([]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    const client = createClient({
      code: name.trim().slice(0, 3).toUpperCase(),
      name: name.trim(),
      industry: industry.trim() || 'Unspecified',
      status: 'onboarding',
      plan,
      dataMode: 'demo',
      enabledModules: modules,
      contactEmail: contactEmail.trim(),
      contactName: contactName.trim(),
    });

    onClose();
    const target = defaultViewFor(client.enabledModules);
    void navigate(
      target
        ? routes.workspace(client.id, target.moduleId, target.viewId)
        : routes.workspaceSettings(client.id)
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a client workspace"
      // Not "provision an isolated client workspace": nothing is isolated
      // here, and the word would be describing infrastructure that does not
      // exist.
      description="Sets up a workspace with demo data. You can change any of this later."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="new-client-form" type="submit" disabled={!name.trim()}>
            Create workspace
          </Button>
        </>
      }
    >
      <form id="new-client-form" onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          Client name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            className="rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Industry
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 py-2"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            Contact name
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Contact email
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 py-2"
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="micro-label mb-1">Plan</legend>
          <div className="flex gap-2">
            {PLANS.map((option) => (
              <Button
                key={option}
                variant={plan === option ? 'primary' : 'secondary'}
                onClick={() => setPlan(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="micro-label mb-1">Modules</legend>
          {MODULE_ORDER.map((id) => {
            const def = MODULE_REGISTRY[id];
            const enabled = modules.includes(id);
            return (
              <div key={id} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-sm">
                  <def.Icon size={16} className={accentClasses(def.accent).text} aria-hidden="true" />
                  {def.name}
                </span>
                <Switch
                  checked={enabled}
                  hideLabel
                  label={`${enabled ? 'Disable' : 'Enable'} ${def.name}`}
                  onChange={(next) =>
                    setModules((prev) => (next ? [...prev, id] : prev.filter((m) => m !== id)))
                  }
                />
              </div>
            );
          })}
        </fieldset>
      </form>
    </Dialog>
  );
}

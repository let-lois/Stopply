import { usePlatform } from '@/lib/state/PlatformProvider';
import { Badge, Button, Card } from '@/components/ui';

// Every control here either works or is visibly disabled and says why. The
// prototype's invite form collected a name, email, role and client and
// discarded all four on submit, and its Edit Permissions button had no
// handler at all.
export default function TeamPage() {
  const { users } = usePlatform();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Team</h1>
          <p className="micro-label mt-1">{users.length} people</p>
        </div>
        <Button disabled title="Inviting people needs the backend, which is not available yet">
          Invite someone
        </Button>
      </div>

      <p className="text-sm text-[var(--color-ink-soft)]">
        Inviting and permission changes need the backend and are switched off in
        this build rather than shown as controls that do nothing.
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map((user) => (
          <Card key={user.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{user.name}</h2>
                <p className="text-sm text-[var(--color-ink-soft)]">{user.email}</p>
              </div>
              <Badge accent={user.status === 'active' ? 'emerald' : 'amber'}>{user.status}</Badge>
            </div>
            <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
              {user.role.replace('_', ' ')}
              {user.clientName ? ` · ${user.clientName}` : ' · platform wide'}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

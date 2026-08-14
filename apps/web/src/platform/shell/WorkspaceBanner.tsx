import { useParams } from 'react-router-dom';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { Badge } from '@/components/ui';

// Which client you are looking at, stated rather than inferred from the
// sidebar. Also states the data source, because a number's meaning depends
// entirely on whether it is real.
export function WorkspaceBanner() {
  const { clientId } = useParams<{ clientId: string }>();
  const { clients } = usePlatform();
  const client = clients.find((c) => c.id === clientId);

  if (!client) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-hairline)] bg-[var(--color-surface-raised)]/50 px-6 py-3">
      <h1 className="text-base font-semibold">{client.name}</h1>
      <Badge accent={client.status === 'active' ? 'emerald' : 'amber'}>{client.status}</Badge>
      <span className="micro-label">{client.plan}</span>
      <span className="ml-auto">
        <Badge accent={client.dataMode === 'live' ? 'sky' : 'amber'}>
          {client.dataMode === 'live' ? 'Live mode' : 'Demo data'}
        </Badge>
      </span>
    </div>
  );
}

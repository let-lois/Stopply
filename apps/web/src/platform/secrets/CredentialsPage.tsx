import { KeyRound } from 'lucide-react';
import { usePlatform } from '@/lib/state/PlatformProvider';
import { Badge, Card, EmptyState } from '@/components/ui';
import { shortDate } from '@/lib/format/datetime';

// Read-only, and deliberately incapable of more.
//
// The prototype's version was the highest-severity item in its audit. It
// masked a pasted secret for display, dropped the real value on the floor,
// persisted nothing, and showed the same hardcoded string for every
// credential when you clicked reveal, all under a heading that read
// "Encrypted vault for client OAuth tokens" with a per-card "Encrypted Vault"
// badge. The danger was not that it was unfinished but that it was
// convincing: somebody would paste a real Meta long-lived token or a Shopify
// Admin API secret into it.
//
// So this page has no input field, no reveal control, and no read path. A
// credential store is write-only by design; no read path means no read
// vulnerability. Nothing here says encrypted, vault, or secure, because
// nothing is.
export default function CredentialsPage() {
  const { credentialRefs } = usePlatform();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Credential references registered for each workspace. Only the last four
          characters are ever shown, and this build has no way to add, read, or
          store a credential value.
        </p>
      </div>

      {credentialRefs.length === 0 ? (
        <EmptyState
          Icon={KeyRound}
          title="No credentials registered"
          body="Adding a credential needs the backend, which is not available yet."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="micro-label pb-3">Workspace</th>
                <th className="micro-label pb-3">Provider</th>
                <th className="micro-label pb-3">Key</th>
                <th className="micro-label pb-3">Ends in</th>
                <th className="micro-label pb-3">Status</th>
                <th className="micro-label pb-3 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {credentialRefs.map((ref) => (
                <tr key={ref.id} className="border-t border-[var(--color-hairline)]">
                  <td className="py-3 pr-4">{ref.clientName}</td>
                  <td className="py-3 pr-4">{ref.provider}</td>
                  <td className="py-3 pr-4 text-[var(--color-ink-soft)]">{ref.keyName}</td>
                  <td className="numeric-display py-3 pr-4">{ref.last4}</td>
                  <td className="py-3 pr-4">
                    <Badge accent={ref.status === 'active' ? 'emerald' : 'amber'}>
                      {ref.status}
                    </Badge>
                  </td>
                  <td className="py-3 text-right text-[var(--color-ink-soft)]">
                    {shortDate(ref.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <p className="micro-label">Adding a credential</p>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Not available yet. Storing a credential safely needs a server that can
          receive it once and write it somewhere the browser can never read
          back. Until that exists there is no form here, because a form that
          accepted a value it could not handle would be worse than none.
        </p>
      </Card>
    </div>
  );
}

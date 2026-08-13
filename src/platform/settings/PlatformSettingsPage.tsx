import { Button, Card } from '@/components/ui';
import { resetAll } from '@/lib/persistence/storage';

export default function PlatformSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <p className="micro-label">Local data</p>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-soft)]">
          This build keeps client configuration and activity in your browser.
          Resetting clears all of it and reloads the seeded demo workspaces.
        </p>
        <Button
          variant="danger"
          className="mt-4"
          onClick={() => {
            resetAll();
            window.location.reload();
          }}
        >
          Reset local data
        </Button>
      </Card>

      <Card>
        <p className="micro-label">What this build does not do</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-[var(--color-ink-soft)]">
          <li>No accounts and no authorization. The identity switcher changes what is shown, not what is permitted.</li>
          <li>No live data. Every module reads demo data generated per workspace.</li>
          <li>No credential storage. Credentials are listed as references only.</li>
        </ul>
      </Card>
    </div>
  );
}

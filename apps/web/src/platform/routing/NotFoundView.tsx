import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { routes } from '@/types/routes';

export function NotFoundView({ title, body }: { title?: string; body?: string }) {
  return (
    <EmptyState
      Icon={Compass}
      title={title ?? 'That page does not exist'}
      body={body ?? 'The link may be out of date, or the page may have moved.'}
      action={
        <Link
          to={routes.clients()}
          className="rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-on-accent)]"
        >
          Back to clients
        </Link>
      }
    />
  );
}

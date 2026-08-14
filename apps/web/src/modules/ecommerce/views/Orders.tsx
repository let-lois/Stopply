import { useModuleData } from '@/lib/data/useModuleData';
import { ModuleGate } from '@/components/ModuleStates';
import { Badge, Card } from '@/components/ui';
import { relativeTime } from '@/lib/format/datetime';

// The view the prototype's route table promised and never rendered: its
// switch had `case 'ecom_dashboard': case 'ecom_orders':` falling through to
// the same component, so the sidebar's Orders button showed the dashboard.
const STATUS_ACCENT = {
  pending: 'amber', fulfilled: 'emerald', refunded: 'rose', cancelled: 'slate',
} as const;

export default function EcommerceOrders() {
  const { data, mode, isLoading, error } = useModuleData('ecommerce');

  return (
    <ModuleGate isLoading={isLoading} error={error} mode={mode} hasData={!!data?.orders.length}>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="micro-label pb-3">Order</th>
              <th className="micro-label pb-3">Customer</th>
              <th className="micro-label pb-3">Status</th>
              <th className="micro-label pb-3 text-right">Items</th>
              <th className="micro-label pb-3 text-right">Total</th>
              <th className="micro-label pb-3 text-right">Placed</th>
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((o) => (
              <tr key={o.id} className="border-t border-[var(--color-hairline)]">
                <td className="numeric-display py-3 pr-4">{o.reference}</td>
                <td className="py-3 pr-4">
                  <span className="block">{o.customerName}</span>
                  <span className="text-xs text-[var(--color-ink-faint)]">{o.customerEmail}</span>
                </td>
                <td className="py-3 pr-4">
                  <Badge accent={STATUS_ACCENT[o.status]}>{o.status}</Badge>
                </td>
                <td className="numeric-display py-3 text-right">{o.itemCount}</td>
                <td className="numeric-display py-3 text-right">
                  ${o.total.toLocaleString()}
                </td>
                <td className="py-3 text-right text-[var(--color-ink-soft)]">
                  {relativeTime(o.placedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ModuleGate>
  );
}

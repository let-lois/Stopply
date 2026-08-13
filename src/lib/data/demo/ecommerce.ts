import type { EcommerceData, Order } from '@/modules/ecommerce/types';
import { between, lastDays, pick, rng } from '@/lib/data/demo/rng';

const FIRST = ['Jordan', 'Casey', 'Morgan', 'Riley', 'Avery', 'Quinn'];
const LAST = ['Carter', 'Diaz', 'Fletcher', 'Osei', 'Nakamura', 'Bell'];
const STATUSES = ['pending', 'fulfilled', 'refunded', 'cancelled'] as const;

export function ecommerceDemo(clientId: string, now: Date): EcommerceData {
  const random = rng(`ecom:${clientId}`);

  const orders: Order[] = Array.from({ length: between(random, 18, 34) }, (_, i) => {
    const name = `${pick(random, FIRST)} ${pick(random, LAST)}`;
    const itemCount = between(random, 1, 6);
    return {
      id: `ord_${clientId}_${i}`,
      reference: `#${1000 + i}`,
      customerName: name,
      customerEmail: `${name.toLowerCase().replace(' ', '.')}@example.invalid`,
      // Weighted so most orders are fulfilled, as they are in a real store.
      status: random() < 0.7 ? 'fulfilled' : pick(random, STATUSES),
      total: itemCount * between(random, 18, 140),
      itemCount,
      placedAt: new Date(now.getTime() - between(random, 0, 29) * 86400000).toISOString(),
    };
  });

  const revenueSeries = lastDays(30, now).map((day) => ({
    day,
    revenue: between(random, 400, 3200),
    orders: between(random, 2, 22),
  }));

  return { orders, revenueSeries };
}

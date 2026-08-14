import type { LogisticsData, Shipment } from '@/modules/logistics/types';
import { between, pick, rng } from '@/lib/data/demo/rng';

const CARRIERS = ['Northline Freight', 'Cardinal Parcel', 'Vector Logistics'];
const CITIES = ['Mesa, AZ', 'Tempe, AZ', 'Tucson, AZ', 'Reno, NV', 'Boise, ID', 'Denver, CO'];
const STATUSES = ['label_created', 'in_transit', 'out_for_delivery', 'delivered', 'exception'] as const;

export function logisticsDemo(clientId: string, now: Date): LogisticsData {
  const random = rng(`log:${clientId}`);

  const shipments: Shipment[] = Array.from({ length: between(random, 12, 24) }, (_, i) => {
    const dispatched = new Date(now.getTime() - between(random, 0, 12) * 86400000);
    return {
      id: `shp_${clientId}_${i}`,
      reference: `NL${200000 + i}`,
      carrier: pick(random, CARRIERS),
      // Exceptions stay rare, so the exception count means something.
      status: random() < 0.08 ? 'exception' : pick(random, STATUSES.slice(0, 4)),
      origin: pick(random, CITIES),
      destination: pick(random, CITIES),
      dispatchedAt: dispatched.toISOString(),
      expectedAt: new Date(dispatched.getTime() + between(random, 1, 6) * 86400000).toISOString(),
    };
  });

  return { shipments };
}

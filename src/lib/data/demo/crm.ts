import type { CrmData, Deal, PipelineStage } from '@/modules/crm/types';
import { between, pick, rng } from '@/lib/data/demo/rng';

const COMPANIES = [
  'Harbourline Group', 'Sable & Ward', 'Northwind Trading', 'Kestrel Industrial',
  'Bright Meridian', 'Alder Point Co',
];
const OWNERS = ['Dana Reyes', 'Marcus Hill', 'Priya Nair', 'Tyler Boone'];
const STAGES: PipelineStage[] = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

export function crmDemo(clientId: string, now: Date): CrmData {
  const random = rng(`crm:${clientId}`);

  const deals: Deal[] = Array.from({ length: between(random, 14, 26) }, (_, i) => {
    const company = pick(random, COMPANIES);
    return {
      id: `deal_${clientId}_${i}`,
      name: `${company} renewal`,
      company,
      // Weighted toward the early stages, the shape of any real pipeline.
      stage: random() < 0.55 ? pick(random, STAGES.slice(0, 3)) : pick(random, STAGES),
      value: between(random, 2400, 48000),
      ownerName: pick(random, OWNERS),
      updatedAt: new Date(now.getTime() - between(random, 0, 20) * 86400000).toISOString(),
    };
  });

  return { deals };
}

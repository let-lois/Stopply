import type { AdLead, AdvertisingData, Campaign } from '@/modules/advertising/types';
import { between, lastDays, pick, rng } from '@/lib/data/demo/rng';

const CAMPAIGN_NAMES = [
  'Spring Promo', 'Always On Search', 'Retargeting Pool', 'Brand Awareness',
  'Local Service Ads', 'Lookalike Prospecting',
];
const FIRST = ['Jordan', 'Casey', 'Morgan', 'Riley', 'Avery', 'Quinn', 'Sky', 'Rowan'];
const LAST = ['Carter', 'Diaz', 'Fletcher', 'Osei', 'Nakamura', 'Bell', 'Ivanov', 'Achebe'];

export function advertisingDemo(clientId: string, now: Date): AdvertisingData {
  const random = rng(`ads:${clientId}`);

  const campaigns = CAMPAIGN_NAMES.slice(0, between(random, 4, 6)).map((name, i): Campaign => {
    const spend = between(random, 1200, 9500);
    const clicks = between(random, 300, 2600);
    const leads = Math.max(1, Math.round(clicks * (0.02 + random() * 0.06)));
    return {
      id: `cmp_${clientId}_${i}`,
      name,
      channel: i % 2 === 0 ? 'meta' : 'google',
      status: random() > 0.2 ? 'active' : 'paused',
      spend,
      impressions: clicks * between(random, 18, 60),
      clicks,
      leads,
      // Kept consistent with spend so ROAS never reads as nonsense.
      revenue: Math.round(spend * (0.8 + random() * 2.4)),
    };
  });

  const leads = Array.from({ length: between(random, 14, 26) }, (_, i): AdLead => {
    const name = `${pick(random, FIRST)} ${pick(random, LAST)}`;
    return {
      id: `lead_${clientId}_${i}`,
      name,
      // .invalid is reserved and can never route, so no demo row can reach a
      // real inbox. The prototype seeded a live-looking government address.
      email: `${name.toLowerCase().replace(' ', '.')}@example.invalid`,
      campaignId: pick(random, campaigns).id,
      stage: pick(random, ['new', 'contacted', 'qualified', 'won', 'lost'] as const),
      createdAt: new Date(now.getTime() - between(random, 0, 29) * 86400000).toISOString(),
      value: between(random, 250, 6400),
    };
  });

  const spendSeries = lastDays(30, now).map((day) => ({
    day,
    spend: between(random, 180, 720),
    leads: between(random, 1, 14),
  }));

  return { campaigns, leads, spendSeries };
}

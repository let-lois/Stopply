import type { AnalyticsData } from '@/modules/analytics/types';
import { between, lastDays, rng } from '@/lib/data/demo/rng';

const SOURCES = ['Organic search', 'Paid search', 'Paid social', 'Direct', 'Referral', 'Email'];

export function analyticsDemo(clientId: string, now: Date): AnalyticsData {
  const random = rng(`analytics:${clientId}`);

  const series = lastDays(30, now).map((day) => {
    const sessions = between(random, 240, 1800);
    // Conversions derive from sessions so the rate is always plausible.
    const conversions = Math.max(1, Math.round(sessions * (0.008 + random() * 0.035)));
    return { day, sessions, conversions, revenue: conversions * between(random, 40, 260) };
  });

  const sources = SOURCES.map((name) => {
    const sessions = between(random, 400, 7200);
    return { name, sessions, conversions: Math.round(sessions * (0.01 + random() * 0.04)) };
  }).sort((a, b) => b.sessions - a.sessions);

  return { series, sources };
}

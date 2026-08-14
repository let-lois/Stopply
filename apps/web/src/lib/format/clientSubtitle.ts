import type { Client } from '@/types';

/**
 * The one line under a workspace's name: its plan and its industry.
 *
 * A helper rather than a template literal at each of the three call sites,
 * because either half can be absent. The BI platform records a plan and no
 * industry, so `${plan} · ${industry}` renders "Starter · " with a separator
 * pointing at nothing, which reads as a value that failed to load rather than
 * one that was never collected.
 */
export function clientSubtitle(client: Pick<Client, 'plan' | 'industry'>): string {
  return [client.plan, client.industry].filter(Boolean).join(' · ');
}

// The canonical four stage funnel. Integrations and parsers write stage
// events against these stages; tenant facing labels come from each
// tenant's funnel_labels_json. The engine never special cases a provider.

export const FUNNEL_STAGES = ['lead', 'scheduled', 'completed', 'purchase'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === 'string' && (FUNNEL_STAGES as readonly string[]).includes(value);
}

export function stageIndex(stage: FunnelStage): number {
  return FUNNEL_STAGES.indexOf(stage);
}

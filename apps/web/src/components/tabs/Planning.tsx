'use client';

// Planning: target input on the tenant's bottom funnel stage, cascade
// backwards through stage rates to required leads and spend, projected
// revenue and ROAS. Assumptions default to the latest month's actuals.
// The What to change panel is deterministic, no LLM.

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { fmtMoney, fmtNum, fmtPct } from '@/lib/format';
import type { FunnelLabels, MonthData, TenantSettings } from '@/lib/types';

export function PlanningTab({
  settings,
  labels,
  months,
}: {
  settings: TenantSettings;
  labels: FunnelLabels;
  months: string[];
}) {
  const [latest, setLatest] = useState<MonthData | null>(null);
  const [target, setTarget] = useState<number>(0);
  const [bookRate, setBookRate] = useState<number>(0.4);
  const [showRate, setShowRate] = useState<number>(0.5);
  const [cpl, setCpl] = useState<number>(50);
  const [revPer, setRevPer] = useState<number>(1000);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!months[0]) return;
    api<MonthData>(`/api/tenant/months/${months[0]}?basis=first`).then(setLatest).catch(() => undefined);
  }, [months]);

  const totals = useMemo(() => {
    const sum = (field: 'leads' | 'scheduled' | 'completed' | 'revenue' | 'spend') =>
      (latest?.channels ?? []).reduce((a, ch) => a + Number(ch[field]), 0);
    return {
      leads: sum('leads'),
      scheduled: sum('scheduled'),
      completed: sum('completed'),
      revenue: sum('revenue'),
      spend: sum('spend'),
    };
  }, [latest]);

  // Scenario presets and defaults come from real numbers.
  useEffect(() => {
    if (!latest || seeded) return;
    if (totals.leads > 0) {
      setBookRate(totals.scheduled / totals.leads || 0.4);
      setCpl(totals.spend / totals.leads || 50);
    }
    if (totals.scheduled > 0) setShowRate(totals.completed / totals.scheduled || 0.5);
    if (totals.completed > 0) setRevPer(totals.revenue / totals.completed || 1000);
    setTarget(Math.max(totals.completed, 10));
    setSeeded(true);
  }, [latest, totals, seeded]);

  const requiredScheduled = showRate > 0 ? target / showRate : 0;
  const requiredLeads = bookRate > 0 ? requiredScheduled / bookRate : 0;
  const requiredSpend = requiredLeads * cpl;
  const projectedRevenue = target * revPer;
  const projectedRoas = requiredSpend > 0 ? projectedRevenue / requiredSpend : 0;

  // Deterministic recommendations: rank paid channels by ROAS, name the
  // best to scale and worst to fix, list zero revenue campaigns with the
  // reclaimable spend summed, and the target aware blended line.
  const advice = useMemo(() => {
    if (!latest) return null;
    const paid = latest.channels.filter((ch) => ch.spend > 0);
    const ranked = [...paid].sort((a, b) => b.revenue / b.spend - a.revenue / a.spend);
    const best = ranked[0];
    const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
    const zeroRevenue = latest.campaigns.filter((c) => c.spend > 0 && c.revenue === 0);
    const reclaimable = zeroRevenue.reduce((a, c) => a + c.spend, 0);
    const blended = totals.spend > 0 ? totals.revenue / totals.spend : 0;
    return { best, worst, zeroRevenue, reclaimable, blended };
  }, [latest, totals]);

  const presets = [
    { label: 'Hold steady', factor: 1 },
    { label: 'Grow 25%', factor: 1.25 },
    { label: 'Grow 50%', factor: 1.5 },
    { label: 'Double', factor: 2 },
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h2>Goals</h2>

      <div className="card stack">
        <div className="row">
          {presets.map((p) => (
            <button
              key={p.label}
              className="small"
              onClick={() => setTarget(Math.round(Math.max(totals.completed, 1) * p.factor))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label>
          Target {labels.completed.toLowerCase()} this month
          <input
            type="number"
            min={0}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
        </label>
        <div className="kpi-grid">
          <Assumption label={`${labels.lead} to ${labels.scheduled} rate`} value={bookRate} onChange={setBookRate} pct />
          <Assumption label={`${labels.scheduled} to ${labels.completed} rate`} value={showRate} onChange={setShowRate} pct />
          <Assumption label={`Cost per ${labels.lead.replace(/s$/, '').toLowerCase()}`} value={cpl} onChange={setCpl} />
          <Assumption label={`Revenue per ${labels.completed.replace(/s$/, '').toLowerCase()}`} value={revPer} onChange={setRevPer} />
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="label">Required {labels.scheduled.toLowerCase()}</div>
          <div className="value num">{fmtNum(Math.ceil(requiredScheduled))}</div>
        </div>
        <div className="kpi">
          <div className="label">Required {labels.lead.toLowerCase()}</div>
          <div className="value num">{fmtNum(Math.ceil(requiredLeads))}</div>
        </div>
        <div className="kpi">
          <div className="label">Required spend</div>
          <div className="value num">{fmtMoney(requiredSpend)}</div>
        </div>
        <div className="kpi">
          <div className="label">Projected revenue</div>
          <div className="value num">{fmtMoney(projectedRevenue)}</div>
        </div>
        <div className="kpi">
          <div className="label">Projected ROAS</div>
          <div className="value num">{projectedRoas.toFixed(1)}x</div>
        </div>
      </div>

      {advice && (
        <div className="card stack">
          <h3>What to change</h3>
          {advice.best && (
            <p>
              Best channel to scale: <b>{advice.best.channel}</b> at{' '}
              {(advice.best.revenue / advice.best.spend).toFixed(1)}x ROAS ({fmtMoney(advice.best.spend)} spend,{' '}
              {fmtMoney(advice.best.revenue)} revenue).
            </p>
          )}
          {advice.worst && advice.worst !== advice.best && (
            <p>
              Worst channel to fix: <b>{advice.worst.channel}</b> at{' '}
              {(advice.worst.revenue / advice.worst.spend).toFixed(1)}x ROAS ({fmtMoney(advice.worst.spend)} spend,{' '}
              {fmtMoney(advice.worst.revenue)} revenue).
            </p>
          )}
          {advice.zeroRevenue.length > 0 && (
            <p>
              {advice.zeroRevenue.length} campaigns spent money with zero matched revenue:{' '}
              {advice.zeroRevenue.map((c) => c.campaign).join(', ')}. Reclaimable spend:{' '}
              <b>{fmtMoney(advice.reclaimable)}</b>.
            </p>
          )}
          <p>
            Blended ROAS runs {advice.blended.toFixed(1)}x.{' '}
            {advice.best
              ? `Hitting the target entirely through ${advice.best.channel} at its current ${(advice.best.revenue / advice.best.spend).toFixed(1)}x would beat the blended path by ${fmtMoney(Math.max(0, projectedRevenue / Math.max(advice.blended, 0.01) - projectedRevenue / Math.max(advice.best.revenue / advice.best.spend, 0.01)))} in spend.`
              : 'Connect spend sources to compare channel paths.'}
          </p>
          {settings.role !== 'viewer' && (
            <p className="muted" style={{ fontSize: 12 }}>
              Deeper analysis lives in the assistant. Ask it about this plan from the chat widget.
            </p>
          )}
          {/*
            Deeper analysis stub, intentionally disabled. A future version
            could regress channel level diminishing returns from the
            campaign history and propose a spend allocation:

            function deeperAnalysis(campaigns: CampaignMetrics[]): SpendPlan {
              // fit marginal CPL per channel, solve for the cheapest mix
              // that reaches requiredLeads under a budget constraint
            }
          */}
        </div>
      )}
    </div>
  );
}

function Assumption({
  label,
  value,
  onChange,
  pct,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  pct?: boolean;
}) {
  return (
    <label className="kpi" style={{ display: 'block' }}>
      <div className="label">{label}</div>
      <input
        type="number"
        step={pct ? 0.01 : 1}
        min={0}
        value={pct ? Number((value).toFixed(2)) : Math.round(value * 100) / 100}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {pct && <span className="muted" style={{ fontSize: 12 }}>{fmtPct(value)}</span>}
    </label>
  );
}

'use client';

// Present: the slide deck builder. 16 by 9 cards themed with the tenant's
// tokens and logo, stage labels from the funnel config, large display
// numbers, dark title slide.

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtMoney, fmtNum, monthLabel } from '@/lib/format';
import type { FunnelLabels, MonthData, TenantSettings } from '@/lib/types';

export function PresentTab({
  settings,
  labels,
  months,
}: {
  settings: TenantSettings;
  labels: FunnelLabels;
  months: string[];
}) {
  const [month, setMonth] = useState(months[0] ?? '');
  const [data, setData] = useState<MonthData | null>(null);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!month) return;
    api<MonthData>(`/api/tenant/months/${month}?basis=first`).then(setData).catch(() => setData(null));
  }, [month]);

  if (months.length === 0) return <div className="card muted">No months to present yet.</div>;

  const total = (field: 'leads' | 'scheduled' | 'completed' | 'revenue' | 'spend') =>
    (data?.channels ?? []).reduce((a, ch) => a + Number(ch[field]), 0);

  const slides: Array<{ kind: 'title' } | { kind: 'kpi'; label: string; value: string; sub?: string } | { kind: 'funnel' }> = [
    { kind: 'title' },
    { kind: 'kpi', label: labels.lead, value: fmtNum(total('leads')), sub: `${fmtMoney(total('spend'))} spend` },
    {
      kind: 'kpi',
      label: labels.completed,
      value: fmtNum(total('completed')),
      sub: `${total('scheduled')} ${labels.scheduled.toLowerCase()}`,
    },
    {
      kind: 'kpi',
      label: 'Revenue',
      value: fmtMoney(total('revenue')),
      sub: total('spend') > 0 ? `${(total('revenue') / total('spend')).toFixed(1)}x ROAS` : undefined,
    },
    { kind: 'funnel' },
  ];

  const current = slides[Math.min(slide, slides.length - 1)]!;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Present</h2>
        <select value={month} onChange={(e) => { setMonth(e.target.value); setSlide(0); }} style={{ width: 'auto' }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, settings.tenant.timezone)}
            </option>
          ))}
        </select>
      </div>

      {current.kind === 'title' && (
        <div className="slide title">
          <div className="big">{settings.tenant.name}</div>
          <div style={{ fontSize: 20 }}>{monthLabel(month, settings.tenant.timezone)} performance</div>
        </div>
      )}
      {current.kind === 'kpi' && (
        <div className="slide">
          <div className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{current.label}</div>
          <div className="big num">{current.value}</div>
          {current.sub && <div className="muted" style={{ fontSize: 18 }}>{current.sub}</div>}
        </div>
      )}
      {current.kind === 'funnel' && data && (
        <div className="slide">
          <div className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>The funnel</div>
          <div className="stack" style={{ gap: 10 }}>
            {(
              [
                { label: labels.lead, v: total('leads') },
                { label: labels.scheduled, v: total('scheduled') },
                { label: labels.completed, v: total('completed') },
                { label: 'Revenue', v: total('revenue'), money: true },
              ] as Array<{ label: string; v: number; money?: boolean }>
            ).map((s) => (
              <div key={s.label} className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 20 }}>{s.label}</span>
                <span className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 30 }}>
                  {s.money ? fmtMoney(s.v) : fmtNum(s.v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="small" disabled={slide === 0} onClick={() => setSlide((s) => s - 1)}>
          Previous
        </button>
        <span className="muted">
          {slide + 1} / {slides.length}
        </span>
        <button className="small" disabled={slide >= slides.length - 1} onClick={() => setSlide((s) => s + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface SeriesPoint {
  day: string;
  value: number;
}

export function MiniAreaChart({ data, label }: { data: SeriesPoint[]; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-indigo)" stopOpacity={0.5} />
            <stop offset="100%" stopColor="var(--color-accent-indigo)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="day"
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          tickFormatter={(d: string) => d.slice(5)}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-hairline)',
            borderRadius: 12,
            color: 'var(--color-ink)',
          }}
          labelStyle={{ color: 'var(--color-ink-faint)' }}
          // Recharts 3 types the value as possibly undefined, so the
          // formatter has to cope rather than assert.
          formatter={(value: unknown) => [
            typeof value === 'number' ? value.toLocaleString() : '',
            label,
          ]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--color-accent-indigo)"
          strokeWidth={2}
          fill="url(#areaFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

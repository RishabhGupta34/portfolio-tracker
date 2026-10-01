import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { formatDate, formatNumber } from '../lib/utils';
import { Activity } from 'lucide-react';

/**
 * Rolling returns over time. For each anchor date in the timeline, computes
 * (current value - value N days ago - net invested in the window) / value N days ago.
 * This isolates market performance from new contributions.
 */
function computeRollingPct(timeline, days) {
  if (!timeline || timeline.length === 0) return [];
  const series = timeline.map((row) => ({
    date: row.date,
    value: row.value || 0,
    invested: row.invested || 0,
    ts: new Date(row.date).getTime(),
  }));

  const out = [];
  let j = 0;
  for (let i = 0; i < series.length; i++) {
    const target = series[i].ts - days * 86400000;
    while (j < i && series[j].ts < target) j++;
    if (j === 0 && series[j].ts > target) {
      out.push({ date: series[i].date, pct: null });
      continue;
    }
    const start = series[j];
    if (!start || start.value <= 0) {
      out.push({ date: series[i].date, pct: null });
      continue;
    }
    const netInvested = series[i].invested - start.invested;
    const ret = ((series[i].value - start.value - netInvested) / start.value) * 100;
    out.push({ date: series[i].date, pct: Math.round(ret * 100) / 100 });
  }
  return out;
}

const WINDOWS = [
  { key: '30', days: 30, label: '1M', color: '#10b981' },
  { key: '90', days: 90, label: '3M', color: '#3b82f6' },
  { key: '365', days: 365, label: '1Y', color: '#f59e0b' },
];

export function RollingReturns({ timeline }) {
  const [activeWindows, setActiveWindows] = useState(['90', '365']);

  const data = useMemo(() => {
    if (!timeline || timeline.length < 30) return null;
    const merged = timeline.map((row) => ({ date: row.date }));
    for (const w of WINDOWS) {
      const series = computeRollingPct(timeline, w.days);
      for (let i = 0; i < merged.length; i++) {
        merged[i][w.key] = series[i]?.pct ?? null;
      }
    }
    return merged;
  }, [timeline]);

  if (!data) return null;

  const last = data[data.length - 1];
  const oneYear = last?.['365'];
  const threeMonth = last?.['90'];

  const toggle = (key) => {
    setActiveWindows((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle>Rolling Returns</CardTitle>
          </div>
          <div className="flex gap-2">
            {WINDOWS.map((w) => {
              const isActive = activeWindows.includes(w.key);
              return (
                <button
                  key={w.key}
                  onClick={() => toggle(w.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                    isActive
                      ? 'text-white border-transparent shadow-sm'
                      : 'text-muted-foreground border-border bg-muted/40 hover:bg-muted'
                  }`}
                  style={isActive ? { backgroundColor: w.color } : undefined}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Trailing return over each window, market-driven only (new investments removed). 0% line = breakeven.
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d) => formatDate(d)}
              minTickGap={50}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
              domain={['auto', 'auto']}
            />
            <Tooltip
              labelFormatter={(d) => formatDate(d)}
              formatter={(value) => (value == null ? ['—', ''] : [`${formatNumber(value, 2)}%`, ''])}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
                color: 'hsl(var(--foreground))',
              }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Legend />
            {WINDOWS.filter((w) => activeWindows.includes(w.key)).map((w) => (
              <Line
                key={w.key}
                type="monotone"
                dataKey={w.key}
                name={w.label}
                stroke={w.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {WINDOWS.map((w) => {
            const v = last?.[w.key];
            const color =
              v == null
                ? 'text-muted-foreground'
                : v >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400';
            return (
              <div key={w.key} className="p-2 rounded bg-muted/30">
                <div className="text-[10px] text-muted-foreground">{w.label} return</div>
                <div className={`text-sm font-semibold ${color}`}>
                  {v == null ? '—' : `${formatNumber(v, 2)}%`}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

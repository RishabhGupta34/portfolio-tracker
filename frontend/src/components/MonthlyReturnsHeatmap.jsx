import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { formatNumber } from '../lib/utils';
import { CalendarDays } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Monthly portfolio return = (end_value - start_value - net_invested_during_month) / start_value.
 * Using the first and last timeline rows whose date falls in the month.
 */
function computeMonthlyReturns(timeline) {
  if (!timeline || timeline.length === 0) return { rows: [], min: 0, max: 0 };

  const byMonth = new Map();
  for (const row of timeline) {
    const d = new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const key = ymKey(d);
    const cur = byMonth.get(key);
    if (!cur) {
      byMonth.set(key, { first: row, last: row });
    } else {
      cur.last = row;
      if (new Date(row.date).getTime() < new Date(cur.first.date).getTime()) cur.first = row;
    }
  }

  const sortedKeys = Array.from(byMonth.keys()).sort();
  const monthly = new Map();
  for (let i = 0; i < sortedKeys.length; i++) {
    const k = sortedKeys[i];
    const m = byMonth.get(k);
    const startValue = m.first.value || 0;
    const endValue = m.last.value || 0;
    const startInvested = m.first.invested || 0;
    const endInvested = m.last.invested || 0;
    const netInvested = endInvested - startInvested;
    let pct = null;
    if (startValue > 0) {
      pct = ((endValue - startValue - netInvested) / startValue) * 100;
    }
    monthly.set(k, pct);
  }

  if (monthly.size === 0) return { rows: [], min: 0, max: 0 };

  const years = Array.from(new Set(sortedKeys.map((k) => Number(k.split('-')[0])))).sort();
  const rows = years.map((y) => {
    const cells = MONTHS.map((_, mIdx) => {
      const k = `${y}-${String(mIdx + 1).padStart(2, '0')}`;
      const v = monthly.get(k);
      return { key: k, value: v == null ? null : Math.round(v * 100) / 100 };
    });
    const yearTotal = cells.reduce((s, c) => (c.value != null ? s + c.value : s), 0);
    return { year: y, cells, yearTotal };
  });

  const allValues = Array.from(monthly.values()).filter((v) => v != null);
  const max = allValues.length ? Math.max(...allValues) : 0;
  const min = allValues.length ? Math.min(...allValues) : 0;
  return { rows, min, max };
}

function colorFor(value, min, max) {
  if (value == null) return 'transparent';
  if (value >= 0) {
    const intensity = max > 0 ? Math.min(1, value / max) : 0;
    const alpha = 0.15 + 0.65 * intensity;
    return `rgba(16, 185, 129, ${alpha.toFixed(2)})`;
  }
  const intensity = min < 0 ? Math.min(1, value / min) : 0;
  const alpha = 0.15 + 0.65 * intensity;
  return `rgba(239, 68, 68, ${alpha.toFixed(2)})`;
}

export function MonthlyReturnsHeatmap({ timeline }) {
  const data = useMemo(() => computeMonthlyReturns(timeline), [timeline]);

  if (!data.rows.length) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <CardTitle>Monthly Returns</CardTitle>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">Best {formatNumber(data.max, 1)}%</span>
            <span className="mx-2">·</span>
            <span className="text-red-600 dark:text-red-400">Worst {formatNumber(data.min, 1)}%</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Each cell is one month's market return (new contributions removed). Hover for value.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr>
                <th className="text-left text-muted-foreground font-normal pb-1 pr-2">Year</th>
                {MONTHS.map((m) => (
                  <th key={m} className="font-normal text-muted-foreground pb-1 px-1 text-center">
                    {m}
                  </th>
                ))}
                <th className="text-right text-muted-foreground font-normal pb-1 pl-2">YTD</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.year}>
                  <td className="pr-2 text-muted-foreground">{r.year}</td>
                  {r.cells.map((c) => {
                    const bg = colorFor(c.value, data.min, data.max);
                    const label = c.value == null ? '' : `${formatNumber(c.value, 1)}%`;
                    return (
                      <td key={c.key} className="px-0.5 py-0.5">
                        <div
                          title={`${c.key}: ${c.value == null ? 'no data' : label}`}
                          className="rounded text-center px-1 py-1.5 border border-border/40"
                          style={{
                            backgroundColor: bg,
                            color: c.value == null ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                          }}
                        >
                          {label || '·'}
                        </div>
                      </td>
                    );
                  })}
                  <td
                    className={`pl-2 text-right font-semibold ${
                      r.yearTotal >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {formatNumber(r.yearTotal, 1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

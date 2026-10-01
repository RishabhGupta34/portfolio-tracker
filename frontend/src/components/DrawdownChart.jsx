import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatDate, formatCurrency, formatNumber } from '../lib/utils';
import { TrendingDown } from 'lucide-react';

/**
 * Drawdown is the percentage drop from each running peak in portfolio value.
 * 0% means at-or-above prior peak; -10% means 10% below the highest value seen.
 * The deepest drawdown across the visible window is highlighted.
 */
export function DrawdownChart({ timeline, hideValues }) {
  const data = useMemo(() => {
    if (!timeline || timeline.length < 2) return null;
    let peak = -Infinity;
    let peakDate = null;
    let maxDrawdown = 0;
    let maxDrawdownDate = null;
    let maxDrawdownPeakDate = null;
    let maxDrawdownValue = 0;
    let maxDrawdownPeakValue = 0;
    let runningPeak = -Infinity;
    let runningPeakDate = null;

    const points = timeline.map((row) => {
      const v = row.value || 0;
      if (v > runningPeak) {
        runningPeak = v;
        runningPeakDate = row.date;
      }
      const dd = runningPeak > 0 ? ((v - runningPeak) / runningPeak) * 100 : 0;
      if (dd < maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownDate = row.date;
        maxDrawdownPeakDate = runningPeakDate;
        maxDrawdownValue = v;
        maxDrawdownPeakValue = runningPeak;
      }
      if (v > peak) {
        peak = v;
        peakDate = row.date;
      }
      return {
        date: row.date,
        drawdown: Math.round(dd * 100) / 100,
        value: v,
        peak: runningPeak,
      };
    });

    const last = points[points.length - 1];
    return {
      points,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownDate,
      maxDrawdownPeakDate,
      maxDrawdownValue,
      maxDrawdownPeakValue,
      currentDrawdown: last.drawdown,
      atPeak: last.drawdown >= -0.1,
      peakValue: peak,
      peakDate,
    };
  }, [timeline]);

  if (!data) return null;

  const severityColor =
    data.maxDrawdown >= -5 ? 'text-emerald-600 dark:text-emerald-400'
      : data.maxDrawdown >= -15 ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-primary" />
            <CardTitle>Drawdown</CardTitle>
          </div>
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Max drawdown</div>
            <div className={`text-base font-semibold ${severityColor}`}>
              {formatNumber(data.maxDrawdown, 2)}%
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Percentage below the running portfolio peak. Helps gauge how deep the worst dips have been.
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.points} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="drawdownFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d) => formatDate(d)}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
              domain={['auto', 0]}
            />
            <Tooltip
              labelFormatter={(d) => formatDate(d)}
              formatter={(value, name) => {
                if (name === 'Drawdown') return [`${formatNumber(value, 2)}%`, 'Drawdown'];
                if (name === 'value') return [hideValues ? '••••' : formatCurrency(value), 'Value'];
                if (name === 'peak') return [hideValues ? '••••' : formatCurrency(value), 'Peak'];
                return [value, name];
              }}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
                color: 'hsl(var(--foreground))',
              }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <Area
              type="monotone"
              dataKey="drawdown"
              name="Drawdown"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#drawdownFill)"
            />
          </AreaChart>
        </ResponsiveContainer>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          <div className="p-2 rounded bg-muted/30">
            <div className="text-[10px] text-muted-foreground">Currently</div>
            <div className={`text-sm font-semibold ${data.atPeak ? 'text-emerald-600 dark:text-emerald-400' : severityColor}`}>
              {data.atPeak ? 'At peak' : `${formatNumber(data.currentDrawdown, 2)}%`}
            </div>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <div className="text-[10px] text-muted-foreground">Worst day</div>
            <div className="text-sm font-semibold">
              {data.maxDrawdownDate ? formatDate(data.maxDrawdownDate) : '—'}
            </div>
          </div>
          <div className="p-2 rounded bg-muted/30 col-span-2 sm:col-span-1">
            <div className="text-[10px] text-muted-foreground">Drop from peak</div>
            <div className="text-sm font-semibold">
              {hideValues
                ? '••••'
                : `${formatCurrency(data.maxDrawdownPeakValue - data.maxDrawdownValue)}`}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

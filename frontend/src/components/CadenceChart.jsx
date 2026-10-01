import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { formatCurrency, formatCurrencyCompact } from '../lib/utils';
import { Calendar } from 'lucide-react';

const MONTHS_TO_SHOW = 18;

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function CadenceChart({ funds, hideValues }) {
  const data = useMemo(() => {
    if (!funds?.length) return { points: [], monthlyAvg: 0, currentMonthDelta: null };

    const buckets = new Map();
    for (const fund of funds) {
      for (const t of fund.transactions || []) {
        if (!t || !t.date || !t.amount) continue;
        if (t.transaction_type === 'bonus') continue;
        const d = new Date(t.date);
        if (isNaN(d.getTime())) continue;
        const key = monthKey(d);
        const sign = t.transaction_type === 'sell' ? -1 : 1;
        const cur = buckets.get(key) || { buy: 0, sell: 0, net: 0 };
        if (sign > 0) cur.buy += t.amount;
        else cur.sell += t.amount;
        cur.net = cur.buy - cur.sell;
        buckets.set(key, cur);
      }
    }

    if (buckets.size === 0) return { points: [], monthlyAvg: 0, currentMonthDelta: null };

    const today = new Date();
    const cursor = new Date(today.getFullYear(), today.getMonth() - (MONTHS_TO_SHOW - 1), 1);
    const points = [];
    for (let i = 0; i < MONTHS_TO_SHOW; i++) {
      const key = monthKey(cursor);
      const b = buckets.get(key) || { buy: 0, sell: 0, net: 0 };
      points.push({ key, label: monthLabel(key), buy: b.buy, sell: b.sell, net: b.net });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const investingMonths = points.filter((p) => p.buy > 0);
    const monthlyAvg = investingMonths.length > 0
      ? investingMonths.reduce((s, p) => s + p.buy, 0) / investingMonths.length
      : 0;

    const last = points[points.length - 1];
    const currentMonthDelta = monthlyAvg > 0 && last
      ? ((last.buy - monthlyAvg) / monthlyAvg) * 100
      : null;

    return { points, monthlyAvg, currentMonthDelta };
  }, [funds]);

  if (!data.points.length) return null;

  const total12m = data.points.slice(-12).reduce((s, p) => s + p.buy, 0);
  const sip12m = total12m / 12;
  const insightColor =
    data.currentMonthDelta == null
      ? 'text-muted-foreground'
      : data.currentMonthDelta > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-orange-600 dark:text-orange-400';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <CardTitle>Investment Cadence</CardTitle>
          </div>
          <div className="text-right text-xs">
            <div className="text-muted-foreground">12M average / month</div>
            <div className="text-base font-semibold">
              {hideValues ? '••••' : formatCurrency(sip12m)}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Net buys (green) and sells (red) per month over the last {MONTHS_TO_SHOW} months
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.points} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrencyCompact(v)} />
            <Tooltip
              formatter={(value, name) => [hideValues ? '••••' : formatCurrency(value), name]}
              labelFormatter={(l) => l}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
                color: 'hsl(var(--foreground))',
              }}
            />
            <ReferenceLine y={data.monthlyAvg} stroke="#3b82f6" strokeDasharray="3 3" />
            <Bar dataKey="net" radius={[3, 3, 0, 0]}>
              {data.points.map((p, i) => (
                <Cell key={i} fill={p.net >= 0 ? '#10b981' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {data.currentMonthDelta != null && (
          <div className="mt-3 text-xs flex items-center justify-between">
            <span className="text-muted-foreground">
              Avg investing month: <span className="font-medium text-foreground">
                {hideValues ? '••••' : formatCurrency(data.monthlyAvg)}
              </span>
            </span>
            <span className={insightColor}>
              {data.points[data.points.length - 1].buy === 0
                ? 'No investment this month yet'
                : `This month ${data.currentMonthDelta >= 0 ? '+' : ''}${data.currentMonthDelta.toFixed(0)}% vs avg`}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

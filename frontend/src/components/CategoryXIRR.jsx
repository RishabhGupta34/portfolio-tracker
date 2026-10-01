import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { formatCurrency, formatNumber } from '../lib/utils';
import { calculateXIRR } from '../lib/calculations';
import { isGoldFund } from '../lib/fundUtils';
import { Activity } from 'lucide-react';

const RISK_FREE = 7.0;

const CATEGORY_LABELS = {
  equity_mf: 'Equity MF',
  stocks: 'Direct Stocks',
  gold: 'Gold/Silver',
  debt_mf: 'Debt MF',
  fd: 'Fixed Deposits',
  ppf: 'PPF',
  epf: 'EPF',
  private: 'Private Shares',
  esop: 'ESOP / RSU',
  other: 'Other',
};

const CATEGORY_ORDER = [
  'equity_mf', 'stocks', 'gold', 'debt_mf', 'fd', 'ppf', 'epf', 'private', 'esop', 'other',
];

function categoryFor(fund) {
  if (!fund) return 'other';
  if (isGoldFund(fund.name) || isGoldFund(fund.symbol) || isGoldFund(fund.scheme_code)) return 'gold';
  switch (fund.type) {
    case 'mutual_fund':
      return 'equity_mf';
    case 'stock':
      return 'stocks';
    case 'fd':
      return 'fd';
    case 'ppf':
      return 'ppf';
    case 'epf':
      return 'epf';
    case 'private_share':
      return 'private';
    case 'esop':
      return 'esop';
    case 'gold':
      return 'gold';
    default:
      return 'other';
  }
}

function depositXirr(fund) {
  return typeof fund.interest_rate === 'number' ? fund.interest_rate : null;
}

function fundCurrentValue(fund) {
  let units = 0;
  let invested = 0;
  for (const t of fund.transactions || []) {
    if (t.transaction_type === 'buy' || t.transaction_type === 'bonus') {
      invested += t.amount || 0;
      units += t.units || 0;
    } else if (t.transaction_type === 'sell') {
      if (units > 0) invested -= (t.units / units) * invested;
      units -= t.units;
    }
  }
  if (['fd', 'ppf', 'epf'].includes(fund.type)) {
    return { value: invested, units };
  }
  const nav = fund.current_nav != null
    ? fund.current_nav
    : (fund.transactions?.length ? fund.transactions[fund.transactions.length - 1].nav : 0);
  return { value: units * nav, units };
}

export function CategoryXIRR({ funds }) {
  const data = useMemo(() => {
    const groups = {};
    for (const fund of funds || []) {
      const cat = categoryFor(fund);
      if (!groups[cat]) groups[cat] = { value: 0, weighted: 0, weight: 0, count: 0 };
      const { value, units } = fundCurrentValue(fund);
      const isDeposit = ['fd', 'ppf', 'epf'].includes(fund.type);
      if (value <= 0 || (!isDeposit && units <= 0)) continue;

      let xirr = null;
      if (isDeposit) {
        xirr = depositXirr(fund);
      } else {
        xirr = calculateXIRR(fund.transactions || [], value);
      }

      groups[cat].count += 1;
      groups[cat].value += value;
      if (xirr != null && isFinite(xirr)) {
        groups[cat].weighted += xirr * value;
        groups[cat].weight += value;
      }
    }

    const points = CATEGORY_ORDER
      .filter((c) => groups[c] && groups[c].value > 0)
      .map((c) => {
        const g = groups[c];
        const xirr = g.weight > 0 ? g.weighted / g.weight : null;
        return {
          key: c,
          label: CATEGORY_LABELS[c],
          value: g.value,
          xirr: xirr != null ? Math.round(xirr * 10) / 10 : null,
          count: g.count,
        };
      });

    const totalValue = points.reduce((s, p) => s + p.value, 0);
    const totalWeighted = points.reduce(
      (s, p) => (p.xirr != null ? s + p.xirr * p.value : s),
      0
    );
    const blendedXirr = points.reduce((s, p) => (p.xirr != null ? s + p.value : s), 0) > 0
      ? totalWeighted / points.reduce((s, p) => (p.xirr != null ? s + p.value : s), 0)
      : null;

    return { points, totalValue, blendedXirr };
  }, [funds]);

  if (!data.points.length) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle>Category Returns</CardTitle>
          </div>
          {data.blendedXirr != null && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Blended XIRR</div>
              <div className="text-base font-semibold">
                {formatNumber(data.blendedXirr, 1)}%
              </div>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Value-weighted XIRR by asset category. Dashed line = risk-free baseline ({RISK_FREE}%).
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(220, data.points.length * 42)}>
          <BarChart data={data.points} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              type="number"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
              domain={['auto', 'auto']}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 11 }}
              width={120}
            />
            <Tooltip
              formatter={(value, name, props) => {
                if (value == null) return ['N/A', 'XIRR'];
                return [`${value}%`, 'XIRR'];
              }}
              labelFormatter={(label) => label}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
                color: 'hsl(var(--foreground))',
              }}
            />
            <ReferenceLine x={RISK_FREE} stroke="#94a3b8" strokeDasharray="3 3" />
            <Bar dataKey="xirr" radius={[0, 3, 3, 0]}>
              {data.points.map((p, i) => {
                const v = p.xirr;
                let color = '#94a3b8';
                if (v != null) {
                  color = v >= RISK_FREE + 5 ? '#10b981'
                    : v >= RISK_FREE ? '#3b82f6'
                    : v >= 0 ? '#f59e0b'
                    : '#ef4444';
                }
                return <Cell key={i} fill={color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {data.points.map((p) => (
            <div key={p.key} className="flex items-center justify-between p-2 rounded bg-muted/30">
              <span className="text-muted-foreground truncate mr-2">{p.label}</span>
              <span className="font-semibold whitespace-nowrap">
                {p.xirr != null ? `${p.xirr}%` : 'N/A'}
                <span className="text-muted-foreground ml-1">
                  ({formatCurrency(p.value)})
                </span>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

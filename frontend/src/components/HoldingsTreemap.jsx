import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { formatCurrency, formatNumber } from '../lib/utils';
import { isGoldFund } from '../lib/fundUtils';
import { loadXRayCache } from '../lib/holdingsAnalysis';
import { Layers } from 'lucide-react';

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

const CATEGORY_COLORS = {
  equity_mf: '#3b82f6',
  stocks: '#10b981',
  gold: '#f59e0b',
  debt_mf: '#8b5cf6',
  fd: '#6366f1',
  ppf: '#0d9488',
  epf: '#0ea5e9',
  private: '#ec4899',
  esop: '#d946ef',
  other: '#94a3b8',
};

function categoryFor(fund) {
  if (!fund) return 'other';
  if (isGoldFund(fund.name) || isGoldFund(fund.symbol) || isGoldFund(fund.scheme_code)) return 'gold';
  switch (fund.type) {
    case 'mutual_fund': return 'equity_mf';
    case 'stock': return 'stocks';
    case 'fd': return 'fd';
    case 'ppf': return 'ppf';
    case 'epf': return 'epf';
    case 'private_share': return 'private';
    case 'esop': return 'esop';
    case 'gold': return 'gold';
    default: return 'other';
  }
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
    return { value: invested, units, invested };
  }
  const nav = fund.current_nav != null
    ? fund.current_nav
    : (fund.transactions?.length ? fund.transactions[fund.transactions.length - 1].nav : 0);
  return { value: units * nav, units, invested };
}

function CustomNode({ x, y, width, height, name, value, fill, depth, totalValue }) {
  if (depth === 0) return null;
  const showLabel = width > 70 && height > 30;
  const showValue = width > 90 && height > 50;
  const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: fill || '#94a3b8',
          stroke: '#fff',
          strokeWidth: 2,
          strokeOpacity: 1,
        }}
      />
      {showLabel && (
        <text
          x={x + 6}
          y={y + 16}
          fill="#fff"
          fontSize={11}
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          <tspan>
            {name?.length > 26 ? `${name.slice(0, 24)}…` : name}
          </tspan>
        </text>
      )}
      {showValue && (
        <text
          x={x + 6}
          y={y + 32}
          fill="#fff"
          fontSize={10}
          opacity={0.85}
          style={{ pointerEvents: 'none' }}
        >
          {formatNumber(pct, 1)}%
        </text>
      )}
    </g>
  );
}

export function HoldingsTreemap({ funds }) {
  const [drillDown, setDrillDown] = useState(false);
  const [xrayCompanies, setXrayCompanies] = useState(null);

  useEffect(() => {
    if (!drillDown) return;
    const cached = loadXRayCache();
    setXrayCompanies(cached?.data?.xray?.companies || null);
  }, [drillDown]);

  const data = useMemo(() => {
    if (drillDown && xrayCompanies && xrayCompanies.length > 0) {
      const total = xrayCompanies.reduce((s, c) => s + (c.totalValue || 0), 0);
      const tree = xrayCompanies
        .filter((c) => (c.totalValue || 0) > 0)
        .slice(0, 60)
        .map((c, i) => ({
          name: c.name || c.symbol || 'Unknown',
          size: c.totalValue,
          fill: CATEGORY_COLORS[Object.keys(CATEGORY_COLORS)[i % Object.keys(CATEGORY_COLORS).length]],
        }));
      return { tree, total, mode: 'companies' };
    }

    const groups = {};
    let total = 0;
    for (const fund of funds || []) {
      const cat = categoryFor(fund);
      const { value, units } = fundCurrentValue(fund);
      const isDeposit = ['fd', 'ppf', 'epf'].includes(fund.type);
      if (value <= 0 || (!isDeposit && units <= 0)) continue;
      if (!groups[cat]) {
        groups[cat] = { name: CATEGORY_LABELS[cat], fill: CATEGORY_COLORS[cat], children: [], value: 0 };
      }
      groups[cat].children.push({
        name: fund.name,
        size: value,
        fill: CATEGORY_COLORS[cat],
        category: cat,
      });
      groups[cat].value += value;
      total += value;
    }
    const tree = Object.values(groups).sort((a, b) => b.value - a.value);
    for (const g of tree) {
      g.children.sort((a, b) => b.size - a.size);
    }
    return { tree, total, mode: 'funds' };
  }, [funds, drillDown, xrayCompanies]);

  if (!data.tree.length) return null;

  const xrayCacheAvailable = !!loadXRayCache()?.data?.xray?.companies?.length;

  return (
    <Card data-report-capture="treemap">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <CardTitle>Holdings Treemap</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            {xrayCacheAvailable && (
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={drillDown}
                  onChange={(e) => setDrillDown(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Drill into MF holdings
              </label>
            )}
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Total</div>
              <div className="text-base font-semibold">{formatCurrency(data.total)}</div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {data.mode === 'companies'
            ? 'Each tile is an underlying company, sized by your effective exposure (from X-Ray cache).'
            : 'Each tile is a fund, sized by current value. Color groups it by asset category.'}
          {!xrayCacheAvailable && ' Run Portfolio X-Ray once to enable per-stock drill-down.'}
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={420}>
          <Treemap
            data={data.tree}
            dataKey="size"
            nameKey="name"
            stroke="#fff"
            content={<CustomNode totalValue={data.total} />}
            isAnimationActive={false}
          >
            <Tooltip
              formatter={(value, name, props) => [formatCurrency(value), props.payload?.name || name]}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '0.5rem',
                color: 'hsl(var(--foreground))',
              }}
            />
          </Treemap>
        </ResponsiveContainer>

        {data.mode === 'funds' && (
          <div className="flex flex-wrap gap-2 mt-4">
            {data.tree.map((g) => (
              <div key={g.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: g.fill }} />
                <span className="text-muted-foreground">{g.name}</span>
                <span className="font-semibold">
                  {data.total > 0 ? `${formatNumber((g.value / data.total) * 100, 1)}%` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

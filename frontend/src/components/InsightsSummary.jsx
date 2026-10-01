import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Lightbulb, Layers, ArrowRight, AlertTriangle, Target } from 'lucide-react';
import { formatNumber, formatCurrency } from '../lib/utils';

const navigate = (tab) =>
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab } }));

/**
 * Compact summary card that surfaces the deeper Insights and X-Ray analysis
 * (which live in their own tabs) so users actually find them from the Dashboard.
 */
export function InsightsSummary({ fundMetrics }) {
  const stats = useMemo(() => {
    const eligible = (fundMetrics || []).filter((fm) => fm.metrics.current_value > 0);
    if (eligible.length === 0) return null;

    const totalValue = eligible.reduce((s, fm) => s + fm.metrics.current_value, 0);

    const sorted = [...eligible].sort((a, b) => b.metrics.current_value - a.metrics.current_value);
    const topConcentrationPct = totalValue > 0
      ? (sorted[0].metrics.current_value / totalValue) * 100
      : 0;

    let hhi = 0;
    for (const fm of eligible) {
      const w = totalValue > 0 ? fm.metrics.current_value / totalValue : 0;
      hhi += w * w;
    }
    const effectiveFunds = hhi > 0 ? 1 / hhi : 0;

    const equityCount = eligible.filter(
      (fm) => ['mutual_fund', 'stock', 'private_share', 'esop'].includes(fm.fund.type)
    ).length;

    const underperformers = eligible.filter(
      (fm) => fm.metrics.absolute_return_pct != null && fm.metrics.absolute_return_pct < 0
    ).length;

    return {
      totalFunds: eligible.length,
      totalValue,
      topName: sorted[0].fund.name,
      topConcentrationPct,
      effectiveFunds,
      equityCount,
      underperformers,
    };
  }, [fundMetrics]);

  if (!stats) return null;

  const concentrationAlert = stats.topConcentrationPct >= 25;
  const diversificationAlert = stats.effectiveFunds < 5 && stats.totalFunds >= 6;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Insights tile */}
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">Fund Insights</CardTitle>
            </div>
            <button
              onClick={() => navigate('insights')}
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              Open <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Per-fund scorecards across fundamentals, technicals, risk, and momentum.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2 rounded bg-muted/30">
              <div className="text-[10px] text-muted-foreground">Equity holdings</div>
              <div className="text-sm font-semibold">{stats.equityCount}</div>
            </div>
            <div className="p-2 rounded bg-muted/30">
              <div className="text-[10px] text-muted-foreground">Underperformers</div>
              <div className={`text-sm font-semibold ${stats.underperformers > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                {stats.underperformers}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* X-Ray tile */}
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-500" />
              <CardTitle className="text-base">Portfolio X-Ray</CardTitle>
            </div>
            <button
              onClick={() => navigate('xray')}
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              Open <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Holdings overlap, concentration, and effective diversification across funds.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2 rounded bg-muted/30">
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Target className="h-3 w-3" /> Top concentration
              </div>
              <div className={`text-sm font-semibold ${concentrationAlert ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                {formatNumber(stats.topConcentrationPct, 1)}%
              </div>
              <div className="text-[10px] text-muted-foreground truncate" title={stats.topName}>
                {stats.topName}
              </div>
            </div>
            <div className="p-2 rounded bg-muted/30">
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                {diversificationAlert && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                Effective funds
              </div>
              <div className="text-sm font-semibold">
                {formatNumber(stats.effectiveFunds, 1)}
                <span className="text-muted-foreground font-normal"> / {stats.totalFunds}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

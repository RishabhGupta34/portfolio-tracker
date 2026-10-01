import { useState, useEffect, useMemo, useCallback } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent } from './ui/Card';
import { formatCurrency } from '../lib/utils';
import {
  getFundHoldings, getETFHoldings, aggregatePortfolioHoldings,
  computePairwiseOverlap, computeDiversificationIndex,
  saveXRayCache, loadXRayCache, clearXRayCache,
  ensureYahooCrumb, getISIN, getYahooSymbol, fetchFundData,
} from '../lib/holdingsAnalysis';
import {
  ChevronDown, ChevronUp, RefreshCw, PieChart, Building2, Layers,
  AlertTriangle, Star, Eye, EyeOff,
  Search, X, BarChart3, Shuffle,
} from 'lucide-react';
import { Skeleton } from './ui/Skeleton';
import { toast } from './ui/Toast';
import {
  PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';

const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#6366f1', '#d946ef', '#0ea5e9', '#10b981', '#e11d48',
  '#a855f7', '#64748b', '#0d9488', '#dc2626', '#4f46e5',
];

export function PortfolioXRay() {
  const [portfolioData, setPortfolioData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentFund: '' });
  const [xrayData, setXrayData] = useState(null);
  const [fundDetails, setFundDetails] = useState({}); // per-fund data keyed by scheme_code/symbol
  const [failedFunds, setFailedFunds] = useState([]); // funds where holdings couldn't be fetched
  const [cacheTimestamp, setCacheTimestamp] = useState(null);
  const [activeTab, setActiveTab] = useState('companies'); // companies | sectors | overlap | funds
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [expandedFund, setExpandedFund] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [hideValues, setHideValues] = useState(() => localStorage.getItem('hideValues') === 'true');

  // Load portfolio data + cache
  useEffect(() => {
    loadPortfolio();
  }, []);

  const loadPortfolio = async () => {
    try {
      setLoading(true);
      const data = await portfolioApi.getDashboard();
      if (data?.data) {
        setPortfolioData(data.data);
      }
      const cached = loadXRayCache();
      if (cached) {
        setXrayData(cached.data.xray);
        setFundDetails(cached.data.fundDetails || {});
        setFailedFunds(cached.data.failedFunds || []);
        setCacheTimestamp(cached.timestamp);
      }
    } catch (e) {
      toast.error('Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };

  // Deduplicated active MF/stock/ETF funds
  const activeFunds = useMemo(() => {
    if (!portfolioData?.fund_metrics) return [];
    const fundMap = new Map();
    for (const fm of portfolioData.fund_metrics) {
      const fund = fm.fund;
      const metrics = fm.metrics;
      if (metrics.current_units <= 0) continue;
      if (['fd', 'ppf', 'epf'].includes(fund.type)) continue;
      const key = fund.scheme_code || fund.symbol || fund.name;
      if (fundMap.has(key)) {
        const existing = fundMap.get(key);
        existing.currentValue += metrics.current_value;
        existing.totalInvested += metrics.total_invested;
      } else {
        fundMap.set(key, {
          key,
          name: fund.name,
          type: fund.type,
          symbol: fund.symbol,
          scheme_code: fund.scheme_code,
          currentValue: metrics.current_value,
          totalInvested: metrics.total_invested,
        });
      }
    }
    return Array.from(fundMap.values());
  }, [portfolioData]);

  const totalPortfolioValue = useMemo(() => activeFunds.reduce((s, f) => s + f.currentValue, 0), [activeFunds]);

  // Run analysis
  const runAnalysis = useCallback(async (forceRefresh = false) => {
    if (analyzing) return;
    if (!forceRefresh && xrayData) return; // use cache

    setAnalyzing(true);
    setProgress({ current: 0, total: activeFunds.length, currentFund: 'Setting up Yahoo Finance session...', step: 'This takes a few seconds' });
    const fundResults = [];
    const details = {};
    const failed = [];
    let successCount = 0;

    // Pre-initialize Yahoo session (cookie + crumb) before looping — max 15s then proceeds anyway
    try {
      await ensureYahooCrumb();
    } catch (e) {
      console.error('[X-Ray] Failed to init Yahoo session:', e.message);
    }

    setProgress({ current: 0, total: activeFunds.length, currentFund: 'Starting analysis...', step: '' });

    for (let i = 0; i < activeFunds.length; i++) {
      const fund = activeFunds[i];
      const updateStep = (step) => setProgress({ current: i + 1, total: activeFunds.length, currentFund: fund.name, step });
      updateStep('');

      try {
        let holdings = null;

        // Direct stocks — no holdings breakdown needed, they ARE the holding
        if (fund.type === 'stock') {
          // aggregatePortfolioHoldings handles stocks as 100% self-holding
          fundResults.push({ fund, holdings: null, currentValue: fund.currentValue });
          continue;
        }

        if (fund.type === 'mutual_fund' && fund.scheme_code) {
          updateStep('Looking up ISIN...');
          const isin = await getISIN(fund.scheme_code);
          if (isin) {
            updateStep('Finding Yahoo symbol...');
            const yahooSymbol = await getYahooSymbol(isin);
            if (yahooSymbol) {
              updateStep('Fetching holdings...');
              holdings = await fetchFundData(yahooSymbol);
            } else {
              console.error(`[X-Ray] No Yahoo symbol for ISIN=${isin} (scheme=${fund.scheme_code})`);
            }
          } else {
            console.error(`[X-Ray] No ISIN for scheme_code=${fund.scheme_code}`);
          }
        }
        // For ETFs, or MFs without scheme_code but with symbol
        if (!holdings && fund.symbol) {
          updateStep('Fetching ETF data...');
          holdings = await getETFHoldings(fund.symbol);
        }

        if (holdings && holdings.holdings?.length > 0) {
          details[fund.key] = holdings;
          successCount++;
        } else {
          failed.push({ name: fund.name, type: fund.type, reason: 'No holdings data on Yahoo Finance' });
        }

        fundResults.push({
          fund,
          holdings,
          currentValue: fund.currentValue,
        });
      } catch (e) {
        failed.push({ name: fund.name, type: fund.type, reason: e.message || 'Fetch error' });
        fundResults.push({ fund, holdings: null, currentValue: fund.currentValue });
      }

      // Rate limiting — avoid throttling
      if (i < activeFunds.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    const aggregated = aggregatePortfolioHoldings(fundResults);
    const pairwise = computePairwiseOverlap(fundResults);
    const diversification = computeDiversificationIndex(fundResults, pairwise);
    aggregated.pairwise = pairwise;
    aggregated.diversification = diversification;
    setXrayData(aggregated);
    setFundDetails(details);
    setFailedFunds(failed);

    // Save to cache (include failed list)
    saveXRayCache({ xray: aggregated, fundDetails: details, failedFunds: failed });
    setCacheTimestamp(Date.now());

    setAnalyzing(false);
    const stockCount = activeFunds.filter(f => f.type === 'stock').length;
    const mfCount = activeFunds.length - stockCount;
    const parts = [];
    if (mfCount > 0) parts.push(`${successCount}/${mfCount} MFs analyzed`);
    if (stockCount > 0) parts.push(`${stockCount} direct stocks`);
    parts.push(`${aggregated.summary.totalCompanies} companies found`);
    toast.success(parts.join(' · '));
  }, [activeFunds, analyzing, xrayData]);

  const handleRefresh = useCallback(() => {
    clearXRayCache();
    setXrayData(null);
    setFundDetails({});
    setFailedFunds([]);
    setCacheTimestamp(null);
    runAnalysis(true);
  }, [runAnalysis]);

  const displayValue = (v) => hideValues ? '••••••' : formatCurrency(v);

  // Filtered companies by search
  const filteredCompanies = useMemo(() => {
    if (!xrayData?.companies) return [];
    if (!searchQuery.trim()) return xrayData.companies;
    const q = searchQuery.toLowerCase();
    return xrayData.companies.filter(c =>
      c.name.toLowerCase().includes(q) || (c.symbol && c.symbol.toLowerCase().includes(q))
    );
  }, [xrayData, searchQuery]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-500" />
            Portfolio X-Ray
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            See which companies and sectors you actually own across all your mutual funds
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHideValues(!hideValues)}
            className="p-2 rounded-lg border border-border hover:bg-muted">
            {hideValues ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          {cacheTimestamp && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              Cached {Math.round((Date.now() - cacheTimestamp) / 3600000)}h ago
            </span>
          )}
          <button onClick={handleRefresh} disabled={analyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${analyzing ? 'animate-spin' : ''}`} />
            {analyzing ? 'Analyzing...' : (xrayData ? 'Refresh' : 'Analyze')}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {analyzing && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground truncate mr-2">
                {progress.current === 0 ? (
                  <span className="font-medium text-foreground">{progress.currentFund}</span>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{progress.currentFund}</span>
                    {progress.step && (
                      <span className="text-xs ml-1 text-muted-foreground">— {progress.step}</span>
                    )}
                  </>
                )}
              </span>
              <span className="font-medium whitespace-nowrap">{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* No data — prompt to analyze */}
      {!xrayData && !analyzing && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
          <CardContent className="p-6 text-center">
            <Layers className="h-12 w-12 mx-auto text-blue-500 mb-3" />
            <h3 className="text-lg font-semibold mb-2">Discover What You Really Own</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-lg mx-auto">
              Your {activeFunds.length} funds hold hundreds of individual stocks. Click below to see your actual
              company-level exposure, sector breakdown, and fund overlap.
            </p>
            <button onClick={() => runAnalysis(true)}
              className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
              Analyze Portfolio Holdings
            </button>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      {xrayData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard icon={Building2} label="Companies" value={xrayData.summary.totalCompanies} color="blue" />
            <SummaryCard icon={PieChart} label="Sectors" value={xrayData.summary.totalSectors} color="purple" />
            <SummaryCard icon={Layers} label="Overlapping" value={xrayData.summary.overlappingCompanies}
              sub="in 2+ funds" color="amber" />
            <SummaryCard
              icon={Shuffle}
              label="Diversification"
              value={xrayData.diversification?.score != null ? `${xrayData.diversification.score}/100` : '—'}
              sub={xrayData.diversification?.label}
              color={xrayData.diversification?.score >= 65 ? 'green' : xrayData.diversification?.score >= 50 ? 'amber' : 'red'}
            />
            <SummaryCard icon={BarChart3} label="Coverage" value={`${xrayData.summary.coveragePercent}%`}
              sub={`of ₹${formatCurrency(xrayData.summary.totalPortfolioValue)} analyzed`} color="green" />
          </div>

          {/* Failed funds notice */}
          {failedFunds.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                {failedFunds.length} fund{failedFunds.length > 1 ? 's' : ''} without holdings data
                <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-1 pl-4 space-y-0.5">
                {failedFunds.map((f, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    • {f.name} <span className="text-muted-foreground/60">({f.type?.replace('_', ' ')})</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border overflow-x-auto">
            {[
              { id: 'companies', label: 'Companies', icon: Building2 },
              { id: 'sectors', label: 'Sector Allocation', icon: PieChart },
              { id: 'overlap', label: 'Fund Overlap', icon: Layers },
              { id: 'funds', label: 'Fund Details', icon: Star },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'companies' && (
            <CompaniesTab companies={filteredCompanies} totalValue={totalPortfolioValue}
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              expandedCompany={expandedCompany} setExpandedCompany={setExpandedCompany}
              displayValue={displayValue} hideValues={hideValues} />
          )}
          {activeTab === 'sectors' && (
            <SectorsTab sectors={xrayData.sectors} totalValue={totalPortfolioValue}
              displayValue={displayValue} hideValues={hideValues} />
          )}
          {activeTab === 'overlap' && (
            <OverlapTab
              overlapping={xrayData.overlapping}
              pairwise={xrayData.pairwise || []}
              diversification={xrayData.diversification}
              displayValue={displayValue}
              hideValues={hideValues}
            />
          )}
          {activeTab === 'funds' && (
            <FundsTab funds={activeFunds} fundDetails={fundDetails}
              expandedFund={expandedFund} setExpandedFund={setExpandedFund}
              displayValue={displayValue} hideValues={hideValues} />
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Summary Card
// ============================================================

function SummaryCard({ icon: Icon, label, value, sub, color }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400',
    red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  };

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`p-1.5 rounded-lg ${colorClasses[color]}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Companies Tab
// ============================================================

function CompaniesTab({ companies, totalValue, searchQuery, setSearchQuery, expandedCompany, setExpandedCompany, displayValue, hideValues }) {
  const [showAll, setShowAll] = useState(false);
  const displayCount = showAll || searchQuery ? companies.length : 25;
  const displayedCompanies = companies.slice(0, displayCount);

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input type="text" placeholder="Search company or symbol..." value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-8 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20" />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {companies.length} companies found across your portfolio (top holdings from each fund, aggregated)
      </p>

      {/* Top 15 visual bar chart */}
      <Card>
        <CardContent className="p-3">
          <h4 className="text-sm font-semibold mb-2">Top 15 Company Exposure</h4>
          <div className="space-y-1.5">
            {companies.slice(0, 15).map((c, i) => (
              <div key={c.symbol || c.name} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium truncate">{c.name}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="font-semibold">{c.portfolioPercent}%</span>
                      {c.fundCount > 1 && (
                        <span className="text-muted-foreground text-[10px]">({c.fundCount} funds)</span>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(c.portfolioPercent * 3, 100)}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Full list */}
      <div className="space-y-1">
        {displayedCompanies.map((c, idx) => {
          const isExpanded = expandedCompany === (c.symbol || c.name);
          return (
            <Card key={c.symbol || c.name} className="overflow-hidden">
              <button onClick={() => setExpandedCompany(isExpanded ? null : (c.symbol || c.name))}
                className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{c.name}</span>
                    {c.symbol && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                        {c.symbol.replace('.NS', '').replace('.BO', '')}
                      </span>
                    )}
                    {c.fundCount > 1 && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 shrink-0">
                        {c.fundCount} funds
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-2 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-semibold">{c.portfolioPercent}%</div>
                    <div className="text-xs text-muted-foreground">{displayValue(c.totalValue)}</div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Exposure from:</p>
                  {c.funds.map((f, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate flex-1 mr-2">{f.fundName}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-muted-foreground">{f.percent}% of fund</span>
                        <span className="font-medium">{displayValue(f.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Show more / less */}
      {!searchQuery && companies.length > 25 && (
        <button onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-sm text-primary hover:underline">
          {showAll ? `Show less` : `Show all ${companies.length} companies`}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Sectors Tab
// ============================================================

function SectorsTab({ sectors, totalValue, displayValue, hideValues }) {
  const chartData = sectors.map((s, i) => ({
    name: s.sector,
    value: s.portfolioPercent,
    totalValue: s.totalValue,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-4">
      {/* Pie chart */}
      <Card>
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold mb-3">Sector Allocation</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPie>
                <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                  dataKey="value" paddingAngle={2} nameKey="name"
                  label={({ name, value }) => `${name} ${value}%`}
                  labelLine={{ strokeWidth: 1 }}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} stroke="none" />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value, name, props) => [
                    `${value}%${!hideValues ? ` (${formatCurrency(props.payload.totalValue)})` : ''}`,
                    name,
                  ]} />
              </RechartsPie>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Sector list */}
      <div className="space-y-1.5">
        {sectors.map((s, i) => (
          <Card key={s.sector}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{s.sector}</span>
                    <span className="font-semibold text-sm">{s.portfolioPercent}%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
                    <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden mr-3">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(s.portfolioPercent * 2.5, 100)}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }} />
                    </div>
                    <span>{displayValue(s.totalValue)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Overlap Tab
// ============================================================

function OverlapTab({ overlapping, pairwise, diversification, displayValue, hideValues }) {
  const [expandedPair, setExpandedPair] = useState(null);
  const hasOverlap = overlapping.length > 0;
  const hasPairs = pairwise && pairwise.length > 0;

  if (!hasOverlap && !hasPairs) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No overlapping companies found across your funds.</p>
        </CardContent>
      </Card>
    );
  }

  const divScore = diversification?.score;
  const divColor = divScore == null ? 'gray' : divScore >= 65 ? 'green' : divScore >= 50 ? 'amber' : 'red';
  const divBg = {
    green: 'border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800',
    amber: 'border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800',
    red: 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800',
    gray: 'border-border bg-muted/40',
  }[divColor];
  const divText = {
    green: 'text-green-600 dark:text-green-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
    gray: 'text-muted-foreground',
  }[divColor];

  const redundantPairs = pairwise.filter(p => p.overlapPercent >= 60);

  return (
    <div className="space-y-3">
      {diversification && (
        <Card className={divBg}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Shuffle className={`h-5 w-5 mt-0.5 shrink-0 ${divText}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-xs text-muted-foreground">Diversification Score</div>
                    <div className={`text-2xl font-bold ${divText}`}>
                      {divScore != null ? `${divScore}/100` : '—'}
                      <span className="ml-2 text-sm font-medium">{diversification.label}</span>
                    </div>
                  </div>
                  {diversification.averageOverlap != null && (
                    <div className="text-xs text-right text-muted-foreground">
                      Avg pair overlap: <span className="font-medium">{diversification.averageOverlap}%</span><br/>
                      {diversification.pairsAnalyzed}/{diversification.totalPossiblePairs} pairs analyzed
                    </div>
                  )}
                </div>
                {diversification.coverageNote && (
                  <div className="mt-2 text-[11px] text-muted-foreground italic">
                    {diversification.coverageNote}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {redundantPairs.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold">{redundantPairs.length} fund pair{redundantPairs.length > 1 ? 's' : ''}</span>
                {' '}share more than 60% of holdings. Consider whether holding both adds diversification or just complexity.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasPairs && (
        <div>
          <h3 className="text-sm font-semibold mb-2 px-1">Fund-pair overlap</h3>
          <div className="space-y-1.5">
            {pairwise.map((p, idx) => {
              const key = `${p.fundA}|${p.fundB}`;
              const isExpanded = expandedPair === key;
              const tone = p.overlapPercent >= 60 ? 'text-red-600' : p.overlapPercent >= 35 ? 'text-amber-600' : 'text-green-600';
              return (
                <Card key={key}>
                  <button
                    onClick={() => setExpandedPair(isExpanded ? null : key)}
                    className="w-full p-3 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground">vs.</div>
                        <div className="text-sm font-medium truncate">{p.fundA}</div>
                        <div className="text-sm font-medium truncate">{p.fundB}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-lg font-bold ${tone}`}>{p.overlapPercent}%</div>
                        <div className="text-[11px] text-muted-foreground">{p.sharedCount} shared</div>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t px-3 py-2 bg-muted/20 space-y-1">
                      {p.sharedCompanies.slice(0, 15).map(s => (
                        <div key={s.key} className="flex items-center justify-between text-xs">
                          <span className="truncate flex-1">{s.name}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {s.weightA.toFixed(1)}% / {s.weightB.toFixed(1)}%
                          </span>
                        </div>
                      ))}
                      {p.sharedCompanies.length > 15 && (
                        <div className="text-[11px] text-muted-foreground italic">
                          +{p.sharedCompanies.length - 15} more shared holdings
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {hasOverlap && (
        <div>
          <h3 className="text-sm font-semibold mb-2 px-1">Companies in 2+ funds</h3>
          <div className="space-y-1.5">
            {overlapping.map(c => (
              <Card key={c.symbol || c.name}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{c.name}</span>
                      {c.symbol && (
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {c.symbol.replace('.NS', '').replace('.BO', '')}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold">{c.portfolioPercent}%</span>
                      <span className="text-xs text-muted-foreground ml-2">{displayValue(c.totalValue)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {c.funds.map(f => (
                      <span key={f} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        {f}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Fund Details Tab
// ============================================================

function FundsTab({ funds, fundDetails, expandedFund, setExpandedFund, displayValue, hideValues }) {
  const fundsWithData = funds.map(f => ({
    ...f,
    details: fundDetails[f.key] || null,
  })).sort((a, b) => b.currentValue - a.currentValue);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Holdings, sector breakdown, Morningstar rating, and trailing returns for each fund.
      </p>

      {fundsWithData.map(fund => {
        const d = fund.details;
        const isExpanded = expandedFund === fund.key;

        return (
          <Card key={fund.key} className="overflow-hidden">
            <button onClick={() => setExpandedFund(isExpanded ? null : fund.key)}
              className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{fund.name}</span>
                  {d?.stats?.morningstarRating && (
                    <span className="flex items-center gap-0.5 text-xs text-amber-500">
                      {Array.from({ length: d.stats.morningstarRating }, (_, i) => (
                        <Star key={i} className="h-3 w-3 fill-current" />
                      ))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span className="capitalize">{fund.type?.replace('_', ' ')}</span>
                  {d ? (
                    <span className="text-green-600">• {d.holdings.length} holdings</span>
                  ) : (
                    <span className="text-muted-foreground">• No holdings data</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 ml-2 shrink-0">
                <div className="text-right">
                  <div className="text-sm font-semibold">{displayValue(fund.currentValue)}</div>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>

            {isExpanded && d && (
              <div className="border-t border-border bg-muted/30 p-3 space-y-4">
                {/* Asset allocation bar */}
                <div>
                  <h5 className="text-xs font-semibold text-muted-foreground mb-1.5">Asset Mix</h5>
                  <div className="flex h-3 rounded-full overflow-hidden">
                    {d.stockPosition > 0 && (
                      <div className="bg-blue-500" style={{ width: `${d.stockPosition}%` }}
                        title={`Equity ${d.stockPosition}%`} />
                    )}
                    {d.bondPosition > 0 && (
                      <div className="bg-green-500" style={{ width: `${d.bondPosition}%` }}
                        title={`Debt ${d.bondPosition}%`} />
                    )}
                    {d.cashPosition > 0 && (
                      <div className="bg-amber-400" style={{ width: `${d.cashPosition}%` }}
                        title={`Cash ${d.cashPosition}%`} />
                    )}
                    {d.otherPosition > 0 && (
                      <div className="bg-gray-400" style={{ width: `${d.otherPosition}%` }}
                        title={`Other ${d.otherPosition}%`} />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                    {d.stockPosition > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Equity {d.stockPosition}%</span>}
                    {d.bondPosition > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Debt {d.bondPosition}%</span>}
                    {d.cashPosition > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />Cash {d.cashPosition}%</span>}
                    {d.otherPosition > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400" />Other {d.otherPosition}%</span>}
                  </div>
                </div>

                {/* Trailing returns */}
                {d.trailingReturns && (
                  <div>
                    <h5 className="text-xs font-semibold text-muted-foreground mb-1.5">Trailing Returns</h5>
                    <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                      {[
                        { label: 'YTD', val: d.trailingReturns.ytd },
                        { label: '1M', val: d.trailingReturns.oneMonth },
                        { label: '3M', val: d.trailingReturns.threeMonth },
                        { label: '1Y', val: d.trailingReturns.oneYear },
                        { label: '3Y', val: d.trailingReturns.threeYear },
                        { label: '5Y', val: d.trailingReturns.fiveYear },
                        { label: '10Y', val: d.trailingReturns.tenYear },
                      ].filter(r => r.val != null).map(r => (
                        <div key={r.label} className="text-center p-1.5 rounded-lg bg-background border border-border">
                          <div className="text-xs text-muted-foreground">{r.label}</div>
                          <div className={`text-sm font-semibold ${r.val >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {r.val > 0 ? '+' : ''}{r.val}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Annual returns */}
                {d.annualReturns?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-muted-foreground mb-1.5">Annual Returns</h5>
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={d.annualReturns.slice(0, 10).reverse()} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                          <RechartsTooltip formatter={(v) => [`${v}%`, 'Return']} />
                          <Bar dataKey="return" radius={[2, 2, 0, 0]}>
                            {d.annualReturns.slice(0, 10).reverse().map((entry, i) => (
                              <Cell key={i} fill={entry.return >= 0 ? '#22c55e' : '#ef4444'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Top holdings */}
                {d.holdings?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-muted-foreground mb-1.5">Top Holdings</h5>
                    <div className="space-y-1">
                      {d.holdings.map((h, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-muted-foreground w-4 text-right">{i + 1}</span>
                            <span className="truncate">{h.name}</span>
                            {h.symbol && (
                              <span className="text-muted-foreground shrink-0">
                                {h.symbol.replace('.NS', '').replace('.BO', '')}
                              </span>
                            )}
                          </div>
                          <span className="font-semibold ml-2 shrink-0">{h.percent}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sector weights */}
                {d.sectorWeightings?.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-muted-foreground mb-1.5">Sector Breakdown</h5>
                    <div className="grid grid-cols-2 gap-1">
                      {d.sectorWeightings.map((sw, i) => (
                        <div key={sw.sector} className="flex items-center gap-1.5 text-xs">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="truncate flex-1">{sw.sector}</span>
                          <span className="font-medium shrink-0">{sw.percent}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fund profile */}
                {(d.profile?.family || d.stats?.inceptionDate) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {d.profile?.family && <span>AMC: <span className="text-foreground">{d.profile.family}</span></span>}
                    {d.stats?.inceptionDate && <span>Since: <span className="text-foreground">{d.stats.inceptionDate}</span></span>}
                    {d.stats?.beta != null && <span>Beta: <span className="text-foreground">{d.stats.beta}</span></span>}
                    {d.profile?.expenseRatio != null && <span>Expense: <span className="text-foreground">{d.profile.expenseRatio}%</span></span>}
                    {d.performance?.yearsUp != null && (
                      <span>Up/Down: <span className="text-green-600">{d.performance.yearsUp}Y</span> / <span className="text-red-500">{d.performance.yearsDown}Y</span></span>
                    )}
                  </div>
                )}
              </div>
            )}

            {isExpanded && !d && (
              <div className="border-t border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                No holdings data available for this {fund.type === 'stock' ? 'stock' : 'fund'}.
                {fund.type === 'stock' && ' (Direct stock holdings show 100% allocation to itself)'}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default PortfolioXRay;

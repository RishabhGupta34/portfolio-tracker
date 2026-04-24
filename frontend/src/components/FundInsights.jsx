import { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { formatCurrency, formatNumber } from '../lib/utils';
import { 
  TrendingUp, TrendingDown, BarChart3, Shield, Zap, Target, 
  ChevronDown, ChevronUp, RefreshCw, AlertTriangle, CheckCircle, 
  XCircle, Minus, Info, Activity, Eye, EyeOff, Filter, ArrowUpDown,
  Search, Star, Clock, Database, X, HelpCircle, Compass
} from 'lucide-react';
import { Skeleton } from './ui/Skeleton';
import { toast } from './ui/Toast';
import { isGoldFund, matchesTypeFilter } from '../lib/fundUtils';
import { calculateXIRR } from '../lib/calculations';
import {
  fetchStockFundamentals,
  fetchHistoricalPrices,
  fetchMFHistoricalNAV,
  computeTechnicalIndicators,
  computeRiskMetrics,
  computeRollingReturns,
  getDiscoverCategories,
  getDiscoverItems,
  analyzeDiscoverItem,
} from '../lib/fundAnalysis';
import {
  subscribe as subscribeBg,
  getState as getBgState,
  startDiscoverAll,
  abortDiscover,
  clearDiscoverState,
  resetDiscoverResults,
} from '../lib/backgroundAnalysis';
import {
  scoreFundamentals,
  scoreTechnicals,
  scoreRisk,
  scoreMomentum,
  scorePersonal,
  computeFinalScore,
} from '../lib/scoringEngine';
import { getTooltip } from '../lib/metricTooltips';
import { loadXRayCache, saveXRayCache, getFundHoldings, ensureYahooCrumb } from '../lib/holdingsAnalysis';

// ============================================================
// CACHE HELPERS
// ============================================================

const CACHE_KEY = 'fund_insights_cache';
const DISCOVER_CACHE_KEY = 'fund_insights_discover_cache';
const CUSTOM_DISCOVER_KEY = 'fund_insights_custom_discover'; // user-searched items

// Cache persists until user manually refreshes — no TTL expiry
function saveToCache(results) {
  try {
    const payload = { timestamp: Date.now(), data: results };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) { /* storage full — ignore */ }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function getCacheAge(timestamp) {
  if (!timestamp) return '';
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function saveDiscoverCache(category, results) {
  try {
    const raw = localStorage.getItem(DISCOVER_CACHE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[category] = { timestamp: Date.now(), data: results };
    localStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

function loadDiscoverCache(category) {
  try {
    const raw = localStorage.getItem(DISCOVER_CACHE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    const entry = all[category];
    if (!entry) return null;
    return entry;
  } catch (e) { return null; }
}

// Custom (user-searched) discover items
function saveCustomDiscover(results) {
  try {
    localStorage.setItem(CUSTOM_DISCOVER_KEY, JSON.stringify({ timestamp: Date.now(), data: results }));
  } catch (e) { /* ignore */ }
}

function loadCustomDiscover() {
  try {
    const raw = localStorage.getItem(CUSTOM_DISCOVER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function FundInsights() {
  const [portfolioData, setPortfolioData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analysisResults, setAnalysisResults] = useState({});
  const [cacheTimestamp, setCacheTimestamp] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [totalToAnalyze, setTotalToAnalyze] = useState(0);
  const [expandedFund, setExpandedFund] = useState(null);
  const [sortBy, setSortBy] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [filterRec, setFilterRec] = useState('all');
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [hideValues, setHideValues] = useState(false);
  const [mainTab, setMainTab] = useState('portfolio'); // portfolio | discover
  const [bgDiscoverRunning, setBgDiscoverRunning] = useState(getBgState().discoverRunning);

  // Track background discover state for the tab indicator
  useEffect(() => {
    return subscribeBg((bgState) => {
      setBgDiscoverRunning(bgState.discoverRunning);
    });
  }, []);

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
      // Load cached results
      const cached = loadFromCache();
      if (cached) {
        setAnalysisResults(cached.data);
        setCacheTimestamp(cached.timestamp);
      }
    } catch (e) {
      toast.error('Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };

  // Deduplicated active funds
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
        existing.totalInvested += metrics.total_invested;
        existing.currentValue += metrics.current_value;
        existing.totalUnits += metrics.current_units;
        existing.allTransactions.push(...(fund.transactions || []));
        existing.accounts.push({ accountId: fund.account_id, invested: metrics.total_invested, value: metrics.current_value, units: metrics.current_units });
      } else {
        fundMap.set(key, {
          key, name: fund.name, type: fund.type, symbol: fund.symbol, schemeCode: fund.scheme_code, currentNav: fund.current_nav,
          totalInvested: metrics.total_invested, currentValue: metrics.current_value, totalUnits: metrics.current_units,
          xirr: metrics.xirr, absoluteReturnPct: metrics.absolute_return_pct,
          dayChange: metrics.day_change, dayChangePct: metrics.day_change_pct,
          allTransactions: [...(fund.transactions || [])],
          accounts: [{ accountId: fund.account_id, invested: metrics.total_invested, value: metrics.current_value, units: metrics.current_units }],
        });
      }
    }
    for (const [, fund] of fundMap) {
      if (fund.accounts.length > 1) {
        const xirr = calculateXIRR(fund.allTransactions, fund.currentValue);
        if (xirr !== null) fund.xirr = xirr;
        fund.absoluteReturnPct = fund.totalInvested > 0 ? ((fund.currentValue - fund.totalInvested) / fund.totalInvested) * 100 : 0;
      }
    }
    return Array.from(fundMap.values());
  }, [portfolioData]);

  const totalPortfolioValue = useMemo(() => activeFunds.reduce((sum, f) => sum + f.currentValue, 0), [activeFunds]);

  const investmentTypes = useMemo(() => {
    const types = new Set();
    activeFunds.forEach(f => { types.add(f.type); if (isGoldFund(f.name) || isGoldFund(f.symbol)) types.add('gold'); });
    return Array.from(types);
  }, [activeFunds]);

  // Run analysis (with cache save)
  const runAnalysis = useCallback(async (forceRefresh = true) => {
    if (activeFunds.length === 0) return;
    if (!forceRefresh) {
      const cached = loadFromCache();
      if (cached) { setAnalysisResults(cached.data); setCacheTimestamp(cached.timestamp); return; }
    }
    setAnalyzing(true); setAnalyzedCount(0); setTotalToAnalyze(activeFunds.length);
    // Load X-Ray cache to enrich MF scoring with Morningstar, expense ratio, trailing returns, etc.
    const xrayCache = loadXRayCache();
    const xrayFundDetails = xrayCache?.data?.fundDetails || {};
    let xrayNewlyFetched = {}; // track on-the-fly fetches to save back
    let yahooSessionReady = false;

    // Check if any MFs are missing X-Ray data — if so, pre-init Yahoo session once
    const mfsMissingXray = activeFunds.filter(f => f.type === 'mutual_fund' && f.schemeCode && !xrayFundDetails[f.key]);
    if (mfsMissingXray.length > 0) {
      try { await ensureYahooCrumb(); yahooSessionReady = true; } catch { /* proceed without */ }
    }

    const results = {};
    for (let i = 0; i < activeFunds.length; i++) {
      const fund = activeFunds[i];
      setAnalyzedCount(i + 1);
      try {
        let priceData = [], fundamentals = null, meta = null;
        const isMutualFund = fund.type === 'mutual_fund';
        if (isMutualFund && fund.schemeCode) {
          const mfData = await fetchMFHistoricalNAV(fund.schemeCode);
          priceData = mfData.history || []; meta = mfData.meta;
          if (priceData.length > 500) priceData = priceData.slice(-500);
        } else if (fund.symbol) {
          priceData = await fetchHistoricalPrices(fund.symbol);
          fundamentals = await fetchStockFundamentals(fund.symbol);
        }
        const technicals = computeTechnicalIndicators(priceData);
        const riskMetrics = computeRiskMetrics(priceData);
        const rollingReturns = computeRollingReturns(priceData);
        const sortedTxns = [...fund.allTransactions].sort((a, b) => a.date.localeCompare(b.date));
        const firstTxnDate = sortedTxns.length > 0 ? new Date(sortedTxns[0].date) : null;
        const holdingDays = firstTxnDate ? Math.floor((Date.now() - firstTxnDate.getTime()) / 86400000) : null;

        // Enrich MF scoring with X-Ray data — fetch on-the-fly if not cached
        let xrayData = xrayFundDetails[fund.key] || null;
        if (!xrayData && isMutualFund && fund.schemeCode && yahooSessionReady) {
          try {
            xrayData = await getFundHoldings(fund.schemeCode);
            if (xrayData) {
              xrayNewlyFetched[fund.key] = xrayData;
            }
          } catch { /* non-critical — proceed without X-Ray enrichment */ }
        }

        const fundScore = scoreFundamentals(fundamentals, isMutualFund, { rollingReturns, riskMetrics, meta, xrayData });
        const techScore = scoreTechnicals(technicals);
        const riskScore = scoreRisk(riskMetrics);
        const momScore = scoreMomentum(rollingReturns, technicals);
        const personalScore = scorePersonal({ xirr: fund.xirr, holdingDays, portfolioWeight: totalPortfolioValue > 0 ? (fund.currentValue / totalPortfolioValue) * 100 : 0, totalInvested: fund.totalInvested, currentValue: fund.currentValue });
        const final = computeFinalScore({ fundamental: fundScore, technical: techScore, risk: riskScore, momentum: momScore, personal: personalScore }, null, isMutualFund);
        results[fund.key] = { fundamentals, technicals, riskMetrics, rollingReturns, meta, holdingDays, xrayData, ...final };
      } catch (err) {
        results[fund.key] = { score: 50, recommendation: { label: 'No Data', color: '#9ca3af', bgColor: '#f3f4f6' }, scores: {}, error: err.message };
      }
      if (i < activeFunds.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    // Save any newly fetched X-Ray data back to cache so future runs are instant
    if (Object.keys(xrayNewlyFetched).length > 0) {
      const existingCache = loadXRayCache();
      const existingDetails = existingCache?.data?.fundDetails || {};
      const mergedDetails = { ...existingDetails, ...xrayNewlyFetched };
      const existingData = existingCache?.data || {};
      saveXRayCache({ ...existingData, fundDetails: mergedDetails });
    }

    setAnalysisResults(results);
    const now = Date.now();
    setCacheTimestamp(now);
    saveToCache(results);
    setAnalyzing(false);
    const xrayCount = Object.keys(xrayNewlyFetched).length;
    const msg = xrayCount > 0
      ? `Analysis complete for ${activeFunds.length} funds (${xrayCount} new X-Ray lookups cached)`
      : `Analysis complete for ${activeFunds.length} funds`;
    toast.success(msg);
  }, [activeFunds, totalPortfolioValue]);

  // Filtered and sorted funds
  const displayFunds = useMemo(() => {
    let funds = [...activeFunds];
    if (selectedTypes.length > 0) funds = funds.filter(f => matchesTypeFilter({ name: f.name, type: f.type, symbol: f.symbol, scheme_code: f.schemeCode }, selectedTypes));
    if (filterRec !== 'all' && Object.keys(analysisResults).length > 0) {
      funds = funds.filter(f => {
        const result = analysisResults[f.key]; if (!result) return false;
        const rl = result.recommendation?.label?.toLowerCase() || '';
        if (filterRec === 'buy') return rl.includes('buy');
        if (filterRec === 'hold') return rl === 'hold';
        if (filterRec === 'sell') return rl.includes('sell');
        return true;
      });
    }
    funds.sort((a, b) => {
      const ra = analysisResults[a.key], rb = analysisResults[b.key];
      let valA, valB;
      switch (sortBy) {
        case 'score': valA = ra?.score ?? -1; valB = rb?.score ?? -1; break;
        case 'name': return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        case 'xirr': valA = a.xirr ?? -999; valB = b.xirr ?? -999; break;
        case 'value': valA = a.currentValue; valB = b.currentValue; break;
        default: valA = ra?.score ?? -1; valB = rb?.score ?? -1;
      }
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });
    return funds;
  }, [activeFunds, analysisResults, selectedTypes, filterRec, sortBy, sortDir]);

  const summary = useMemo(() => {
    const counts = { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0, noData: 0 };
    const totalScore = { sum: 0, count: 0 };
    const failedFunds = [];
    activeFunds.forEach(f => {
      const r = analysisResults[f.key];
      if (!r) { counts.noData++; return; }
      if (r.error) {
        failedFunds.push({ name: f.name, key: f.key, type: f.type, symbol: f.symbol, schemeCode: f.schemeCode, error: r.error });
      }
      const label = r.recommendation?.label || '';
      if (label === 'Strong Buy') counts.strongBuy++;
      else if (label === 'Buy') counts.buy++;
      else if (label === 'Hold') counts.hold++;
      else if (label === 'Sell') counts.sell++;
      else if (label === 'Strong Sell') counts.strongSell++;
      else counts.noData++;
      if (r.score !== undefined) { totalScore.sum += r.score; totalScore.count++; }
    });
    return { ...counts, avgScore: totalScore.count > 0 ? Math.round(totalScore.sum / totalScore.count) : null, total: activeFunds.length, analyzed: Object.keys(analysisResults).length, failedFunds };
  }, [activeFunds, analysisResults]);

  // ============================================================
  // RENDER
  // ============================================================

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const hasResults = Object.keys(analysisResults).length > 0;

  return (
    <TooltipProvider>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold">Fund Insights & Recommendations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Analysis using technical, fundamental, risk & momentum signals
            {cacheTimestamp && hasResults && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">
                <Database className="h-3 w-3" /> Cached {getCacheAge(cacheTimestamp)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHideValues(!hideValues)} className="p-2 rounded-lg hover:bg-muted transition-colors">
            {hideValues ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button onClick={() => runAnalysis(true)} disabled={analyzing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
            <RefreshCw className={`h-4 w-4 ${analyzing ? 'animate-spin' : ''}`} />
            {analyzing ? `${analyzedCount}/${totalToAnalyze}` : hasResults ? 'Refresh' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 border-b">
        <button onClick={() => setMainTab('portfolio')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'portfolio' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Target className="h-4 w-4 inline mr-1.5" />My Portfolio
        </button>
        <button onClick={() => setMainTab('discover')}
          className={`relative px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'discover' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          <Compass className="h-4 w-4 inline mr-1.5" />Discover New
          {bgDiscoverRunning && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/75 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
          )}
        </button>
      </div>

      {/* ==================== PORTFOLIO TAB ==================== */}
      {mainTab === 'portfolio' && (
        <>
          {/* Info banner if no analysis yet */}
          {!hasResults && !analyzing && (
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-blue-700 dark:text-blue-300">Click "Run Analysis" to get started</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                      Fetches real-time data from Yahoo Finance & MFAPI and computes 30+ signals per fund.
                      Results are <strong>cached until you refresh</strong> so you won't have to wait next time.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Progress bar */}
          {analyzing && (
            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Analyzing funds...</span>
                <span className="text-sm text-muted-foreground">{analyzedCount}/{totalToAnalyze}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${totalToAnalyze > 0 ? (analyzedCount / totalToAnalyze) * 100 : 0}%` }} />
              </div>
              {analyzedCount > 0 && analyzedCount <= activeFunds.length && (
                <p className="text-xs text-muted-foreground mt-2">Currently: {activeFunds[analyzedCount - 1]?.name}</p>
              )}
            </CardContent></Card>
          )}

          {/* Summary Cards */}
          {hasResults && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <SummaryCard label="Avg Score" value={summary.avgScore} icon={Target} color="blue" />
              <SummaryCard label="Strong Buy" value={summary.strongBuy} icon={CheckCircle} color="green" onClick={() => setFilterRec(filterRec === 'buy' ? 'all' : 'buy')} active={filterRec === 'buy'} />
              <SummaryCard label="Buy" value={summary.buy} icon={TrendingUp} color="emerald" onClick={() => setFilterRec(filterRec === 'buy' ? 'all' : 'buy')} active={filterRec === 'buy'} />
              <SummaryCard label="Hold" value={summary.hold} icon={Minus} color="amber" onClick={() => setFilterRec(filterRec === 'hold' ? 'all' : 'hold')} active={filterRec === 'hold'} />
              <SummaryCard label="Sell" value={summary.sell} icon={TrendingDown} color="orange" onClick={() => setFilterRec(filterRec === 'sell' ? 'all' : 'sell')} active={filterRec === 'sell'} />
              <SummaryCard label="Strong Sell" value={summary.strongSell} icon={XCircle} color="red" onClick={() => setFilterRec(filterRec === 'sell' ? 'all' : 'sell')} active={filterRec === 'sell'} />
            </div>
          )}

          {/* Failed funds warning */}
          {hasResults && summary.failedFunds.length > 0 && (
            <FailedFundsCard failedFunds={summary.failedFunds} />
          )}

          {/* Filters */}
          {hasResults && (
            <div className="flex flex-wrap items-center gap-2">
              {investmentTypes.map(type => (
                <button key={type} onClick={() => setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${selectedTypes.includes(type) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted'}`}>
                  {type === 'mutual_fund' ? 'Mutual Fund' : type === 'stock' ? 'Stock' : type === 'gold' ? 'Gold/Silver' : type}
                </button>
              ))}
              {(selectedTypes.length > 0 || filterRec !== 'all') && (
                <button onClick={() => { setSelectedTypes([]); setFilterRec('all'); }}
                  className="px-3 py-1 text-xs rounded-full border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">Clear filters</button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-xs border rounded-md px-2 py-1 bg-background">
                  <option value="score">Sort by Score</option>
                  <option value="name">Sort by Name</option>
                  <option value="xirr">Sort by XIRR</option>
                  <option value="value">Sort by Value</option>
                </select>
                <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} className="p-1 rounded hover:bg-muted">
                  <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Fund list */}
          {hasResults && (
            <div className="space-y-2">
              {displayFunds.map(fund => (
                <FundInsightCard key={fund.key} fund={fund} analysis={analysisResults[fund.key]}
                  expanded={expandedFund === fund.key} onToggle={() => setExpandedFund(expandedFund === fund.key ? null : fund.key)}
                  hideValues={hideValues} portfolioValue={totalPortfolioValue} />
              ))}
              {displayFunds.length === 0 && (
                <Card><CardContent className="p-8 text-center text-muted-foreground">No funds match the current filters.</CardContent></Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ==================== DISCOVER TAB ==================== */}
      {mainTab === 'discover' && <DiscoverSection activeFunds={activeFunds} />}
    </div>
    </TooltipProvider>
  );
}

// ============================================================
// DISCOVER SECTION
// ============================================================

function DiscoverSection({ activeFunds }) {
  const categories = getDiscoverCategories();
  const [discoverType, setDiscoverType] = useState('mf'); // 'mf' | 'stock'
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [discoverResults, setDiscoverResults] = useState({});
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverProgress, setDiscoverProgress] = useState({ current: 0, total: 0, currentCat: '', catProgress: '' });
  const [expandedDiscover, setExpandedDiscover] = useState(null);
  const [sortBy, setSortBy] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [filterSources, setFilterSources] = useState([]); // [] = show all; multi-select of 'portfolio' | 'custom' | category names

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [analyzingCustom, setAnalyzingCustom] = useState(null);
  const [customResults, setCustomResults] = useState(() => {
    const cached = loadCustomDiscover();
    return cached?.data || {};
  });
  const searchTimerRef = useRef(null);

  // Portfolio items as discover items
  const [portfolioResults, setPortfolioResults] = useState(() => {
    const cached = loadFromCache();
    return cached?.data || {};
  });

  const catList = discoverType === 'stock' ? categories.stocks : categories.mutualFunds;

  // Build portfolio items for discover view (auto-updated when activeFunds changes)
  const portfolioDiscoverItems = useMemo(() => {
    if (!activeFunds || activeFunds.length === 0) return {};
    const items = {};
    activeFunds.forEach(f => {
      const key = f.schemeCode || f.symbol || f.key;
      if (!key) return;
      // Filter by current type
      if (discoverType === 'mf' && f.type !== 'mutual_fund') return;
      if (discoverType === 'stock' && f.type !== 'stock') return;
      // Use cached portfolio analysis if available
      if (portfolioResults[key]) {
        items[key] = {
          ...portfolioResults[key],
          item: { name: f.name, type: f.type, symbol: f.symbol, schemeCode: f.schemeCode },
          _source: 'portfolio',
        };
      } else {
        // Placeholder — not yet analyzed
        items[key] = {
          item: { name: f.name, type: f.type, symbol: f.symbol, schemeCode: f.schemeCode },
          score: null,
          recommendation: { label: 'Not Analyzed', color: '#9ca3af', bgColor: '#f3f4f6' },
          scores: {},
          _source: 'portfolio',
        };
      }
    });
    return items;
  }, [activeFunds, discoverType, portfolioResults]);

  // Refresh portfolioResults when cache changes (e.g., after portfolio analysis runs)
  useEffect(() => {
    const cached = loadFromCache();
    if (cached?.data) setPortfolioResults(cached.data);
  }, []);

  // Subscribe to background analysis state
  useEffect(() => {
    const unsub = subscribeBg((bgState) => {
      if (bgState.discoverRunning) {
        setAnalyzingAll(true);
        setDiscoverLoading(true);
        setDiscoverProgress(bgState.discoverProgress);
        setDiscoverResults(bgState.discoverResults);
      } else if (bgState.discoverDone) {
        setAnalyzingAll(false);
        setDiscoverLoading(false);
        setDiscoverResults(bgState.discoverResults);
        setFilterSources([]);
        clearDiscoverState();
      }
    });
    // On mount, check if background task already has results
    const bgState = getBgState();
    if (bgState.discoverRunning) {
      setAnalyzingAll(true);
      setDiscoverLoading(true);
      setDiscoverProgress(bgState.discoverProgress);
      setDiscoverResults(bgState.discoverResults);
    } else if (Object.keys(bgState.discoverResults).length > 0 && bgState.discoverDone) {
      setDiscoverResults(bgState.discoverResults);
      setFilterSources([]);
      clearDiscoverState();
    }
    return unsub;
  }, []);

  // Analyze a single item and return its result
  const analyzeOneItem = async (item) => {
    try {
      const raw = await analyzeDiscoverItem(item);
      const isMF = item.type === 'mutual_fund';
      const fundScore = scoreFundamentals(raw.fundamentals, isMF, { rollingReturns: raw.rollingReturns, riskMetrics: raw.riskMetrics, meta: raw.meta });
      const techScore = scoreTechnicals(raw.technicals);
      const riskScore = scoreRisk(raw.riskMetrics);
      const momScore = scoreMomentum(raw.rollingReturns, raw.technicals);
      const final = computeFinalScore({
        fundamental: fundScore, technical: techScore, risk: riskScore, momentum: momScore,
        personal: { score: 50, details: {}, label: 'N/A' },
      }, null, isMF);
      return {
        ...final, item,
        fundamentals: raw.fundamentals, technicals: raw.technicals,
        riskMetrics: raw.riskMetrics, rollingReturns: raw.rollingReturns, meta: raw.meta,
      };
    } catch (err) {
      return { item, score: 50, recommendation: { label: 'No Data', color: '#9ca3af', bgColor: '#f3f4f6' }, scores: {}, error: err.message };
    }
  };

  // Analyze a single category (used for individual category clicks)
  const analyzeCategory = useCallback(async (cat) => {
    setSelectedCategory(cat);

    // Check cache
    const cacheKey = `${discoverType}:${cat}`;
    const cached = loadDiscoverCache(cacheKey);
    if (cached) {
      setDiscoverResults(cached.data);
      return cached.data;
    }

    const items = getDiscoverItems(discoverType === 'stock' ? 'stock' : 'mf', cat);
    setDiscoverLoading(true);
    setDiscoverProgress(p => ({ ...p, current: 0, total: items.length, currentCat: cat, catProgress: '' }));
    const results = {};

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setDiscoverProgress(p => ({ ...p, current: i + 1, total: items.length }));
      results[item.symbol || item.schemeCode] = await analyzeOneItem(item);
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    saveDiscoverCache(cacheKey, results);
    setDiscoverResults(results);
    setDiscoverLoading(false);
    toast.success(`Analyzed ${items.length} ${discoverType === 'stock' ? 'stocks' : 'funds'} in "${cat}"`);
    return results;
  }, [discoverType]);

  // Background Analyze ALL categories — runs even if you navigate away
  const analyzeAll = useCallback((forceRefresh = false) => {
    // Reset background state first so it's not blocked by previous run
    clearDiscoverState();
    resetDiscoverResults();

    const type = discoverType;
    const analyzeCatBg = async (cat, mergeInto, onProgress) => {
      if (!forceRefresh) {
        const cacheKey = `${type}:${cat}`;
        const cached = loadDiscoverCache(cacheKey);
        if (cached) {
          Object.assign(mergeInto, cached.data);
          return cached.data;
        }
      }

      const items = getDiscoverItems(type === 'stock' ? 'stock' : 'mf', cat);
      onProgress({ current: 0, total: items.length });
      const results = {};

      for (let i = 0; i < items.length; i++) {
        if (getBgState().discoverAborted) break;
        const item = items[i];
        onProgress({ current: i + 1, total: items.length });
        try {
          const raw = await analyzeDiscoverItem(item);
          const isMF = item.type === 'mutual_fund';
          const fundScore = scoreFundamentals(raw.fundamentals, isMF, { rollingReturns: raw.rollingReturns, riskMetrics: raw.riskMetrics, meta: raw.meta });
          const techScore = scoreTechnicals(raw.technicals);
          const riskScore = scoreRisk(raw.riskMetrics);
          const momScore = scoreMomentum(raw.rollingReturns, raw.technicals);
          const final = computeFinalScore({
            fundamental: fundScore, technical: techScore, risk: riskScore, momentum: momScore,
            personal: { score: 50, details: {}, label: 'N/A' },
          }, null, isMF);
          results[item.symbol || item.schemeCode] = {
            ...final, item,
            fundamentals: raw.fundamentals, technicals: raw.technicals,
            riskMetrics: raw.riskMetrics, rollingReturns: raw.rollingReturns, meta: raw.meta,
          };
        } catch (err) {
          results[item.symbol || item.schemeCode] = { item, score: 50, recommendation: { label: 'No Data', color: '#9ca3af', bgColor: '#f3f4f6' }, scores: {}, error: err.message };
        }
        if (i < items.length - 1) await new Promise(r => setTimeout(r, 400));
      }

      const cacheKey = `${type}:${cat}`;
      saveDiscoverCache(cacheKey, results);
      Object.assign(mergeInto, results);
      return results;
    };

    startDiscoverAll(type, catList, analyzeCatBg);
  }, [discoverType, catList]);

  // Search handler — debounced
  const handleSearch = useCallback((query) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query || query.length < 2) { setSearchResults([]); return; }

    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        if (discoverType === 'mf') {
          const res = await portfolioApi.searchMutualFund(query);
          const results = res?.data?.results || res?.results || [];
          setSearchResults(results.map(r => ({
            key: String(r.scheme_code),
            schemeCode: String(r.scheme_code),
            name: r.scheme_name,
            type: 'mutual_fund',
          })));
        } else {
          // For stocks, treat query as symbol(s) — split by comma/space
          const symbols = query.toUpperCase().split(/[,\s]+/).filter(Boolean);
          setSearchResults(symbols.map(s => ({
            key: s,
            symbol: s + '.NS',
            name: s,
            type: 'stock',
          })));
        }
      } catch (e) {
        toast.error('Search failed');
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [discoverType]);

  // Analyze a custom searched item
  const analyzeCustomItem = useCallback(async (item) => {
    const key = item.schemeCode || item.symbol || item.key;
    if (customResults[key]) {
      // Already analyzed, just expand it
      setExpandedDiscover(key);
      return;
    }
    setAnalyzingCustom(key);
    try {
      const analyzeItem = {
        symbol: item.symbol || null,
        schemeCode: item.schemeCode || null,
        name: item.name,
        type: item.type,
      };
      const result = await analyzeOneItem(analyzeItem);
      const updated = { ...customResults, [key]: result };
      setCustomResults(updated);
      saveCustomDiscover(updated);
      setExpandedDiscover(key);
      toast.success(`Analyzed: ${item.name}`);
    } catch (err) {
      toast.error(`Failed to analyze ${item.name}`);
    } finally {
      setAnalyzingCustom(null);
    }
  }, [customResults]);

  // Merge all sources and apply filter (multi-select)
  const sortedResults = useMemo(() => {
    let combined = {};
    const showAll = filterSources.length === 0;
    const hasPortfolio = filterSources.includes('portfolio');
    const hasCustom = filterSources.includes('custom');
    const categoryFilters = filterSources.filter(f => f !== 'portfolio' && f !== 'custom');

    if (showAll) {
      // Show everything: discover + custom + portfolio
      combined = { ...discoverResults };
      for (const [key, val] of Object.entries(customResults)) {
        if (!combined[key]) combined[key] = { ...val, _source: 'custom' };
        else combined[key] = { ...combined[key], _source: combined[key]._source };
      }
      for (const [key, val] of Object.entries(portfolioDiscoverItems)) {
        if (!combined[key]) combined[key] = val;
      }
    } else {
      // Build from selected sources
      if (hasPortfolio) {
        for (const [key, val] of Object.entries(portfolioDiscoverItems)) {
          combined[key] = val;
        }
      }
      if (hasCustom) {
        for (const [key, val] of Object.entries(customResults)) {
          if (!combined[key]) combined[key] = { ...val, _source: 'custom' };
          else combined[key] = { ...combined[key] };
        }
      }
      if (categoryFilters.length > 0) {
        for (const cat of categoryFilters) {
          const cached = loadDiscoverCache(`${discoverType}:${cat}`);
          if (cached) {
            for (const [key, val] of Object.entries(cached.data)) {
              if (!combined[key]) combined[key] = val;
            }
          }
        }
        // Also add from currently loaded discoverResults
        for (const [key, val] of Object.entries(discoverResults)) {
          if (!combined[key]) combined[key] = val;
        }
      }
    }

    const arr = Object.entries(combined).map(([key, val]) => ({
      key, ...val,
      isCustom: !!customResults[key],
      isPortfolio: val._source === 'portfolio',
    }));
    arr.sort((a, b) => {
      let valA, valB;
      switch (sortBy) {
        case 'score': valA = a.score ?? -1; valB = b.score ?? -1; break;
        case 'name': return sortDir === 'asc' ? (a.item?.name || '').localeCompare(b.item?.name || '') : (b.item?.name || '').localeCompare(a.item?.name || '');
        case 'return1Y':
          valA = a.rollingReturns?.return1Y ?? -999;
          valB = b.rollingReturns?.return1Y ?? -999;
          break;
        default: valA = a.score ?? -1; valB = b.score ?? -1;
      }
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });
    return arr;
  }, [discoverResults, customResults, portfolioDiscoverItems, filterSources, sortBy, sortDir, discoverType]);

  return (
    <div className="space-y-4">
      <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950 dark:border-purple-800">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Compass className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-purple-700 dark:text-purple-300">Discover New Investments</p>
              <p className="text-sm text-purple-600 dark:text-purple-400 mt-1">
                Pick a category below or search for a specific stock/fund. Same 30+ signal analysis is run on each.
                Results are cached until you manually refresh.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Type toggle */}
      <div className="flex items-center gap-2">
        <button onClick={() => { setDiscoverType('mf'); setSelectedCategory(null); setDiscoverResults({}); resetDiscoverResults(); }}
          className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${discoverType === 'mf' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          disabled={analyzingAll}>
          Mutual Funds
        </button>
        <button onClick={() => { setDiscoverType('stock'); setSelectedCategory(null); setDiscoverResults({}); resetDiscoverResults(); }}
          className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${discoverType === 'stock' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          disabled={analyzingAll}>
          Stocks
        </button>
      </div>

      {/* Source filter chips — multi-select */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Show All chip — clears all filters */}
        <button onClick={() => {
          if (discoverLoading) return;
          setFilterSources([]);
          const allCached = {};
          catList.forEach(cat => {
            const cached = loadDiscoverCache(`${discoverType}:${cat}`);
            if (cached) Object.assign(allCached, cached.data);
          });
          setDiscoverResults(allCached);
          setSelectedCategory(null);
        }} disabled={discoverLoading}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-all font-medium ${filterSources.length === 0 ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/30' : 'bg-background border-border hover:bg-muted disabled:opacity-50'}`}>
          Show All
        </button>
        {/* Portfolio chip */}
        <button onClick={() => {
          if (discoverLoading) return;
          setFilterSources(prev => prev.includes('portfolio') ? prev.filter(f => f !== 'portfolio') : [...prev, 'portfolio']);
          setSelectedCategory(null);
        }} disabled={discoverLoading}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-all font-medium ${filterSources.includes('portfolio') ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/30' : 'bg-background border-border hover:bg-muted disabled:opacity-50'}`}>
          My Portfolio ({Object.keys(portfolioDiscoverItems).length})
        </button>
        {/* Custom chip — always show */}
        <button onClick={() => {
          if (discoverLoading) return;
          setFilterSources(prev => prev.includes('custom') ? prev.filter(f => f !== 'custom') : [...prev, 'custom']);
          setSelectedCategory(null);
        }} disabled={discoverLoading}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-all font-medium ${filterSources.includes('custom') ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/30' : 'bg-background border-border hover:bg-muted disabled:opacity-50'}`}>
          Custom ({Object.keys(customResults).length})
        </button>
        <span className="text-muted-foreground text-xs px-1">|</span>
        {catList.map(cat => (
          <button key={cat} onClick={() => {
            if (discoverLoading) return;
            setFilterSources(prev => prev.includes(cat) ? prev.filter(f => f !== cat) : [...prev, cat]);
            analyzeCategory(cat);
          }} disabled={discoverLoading}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${filterSources.includes(cat) ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/30' : 'bg-background border-border hover:bg-muted disabled:opacity-50'}`}>
            {cat}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {discoverLoading && (
            <button onClick={() => { if (analyzingAll) abortDiscover(); }} className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-950">
              Stop
            </button>
          )}
          <button onClick={analyzeAll} disabled={discoverLoading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${analyzingAll ? 'animate-spin' : ''}`} />
            {analyzingAll ? 'Analyzing...' : 'Analyze All'}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSearch(!showSearch)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${showSearch ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted'}`}>
            <Search className="h-3.5 w-3.5" />
            {showSearch ? 'Hide Search' : 'Search & Add'}
          </button>
          {Object.keys(customResults).length > 0 && (
            <span className="text-xs text-muted-foreground">
              {Object.keys(customResults).length} custom item{Object.keys(customResults).length > 1 ? 's' : ''} analyzed
            </span>
          )}
        </div>

        {showSearch && (
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder={discoverType === 'mf' ? 'Search mutual fund by name...' : 'Enter stock symbol (e.g. RELIANCE, TCS)'}
                  className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {searching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {searchResults.length > 0 && (
                <div className="max-h-72 overflow-y-auto divide-y rounded-lg border">
                  {searchResults.map(item => {
                    const key = item.schemeCode || item.symbol || item.key;
                    const alreadyAnalyzed = !!customResults[key] || !!discoverResults[key];
                    return (
                      <button key={key} onClick={() => analyzeCustomItem(item)} disabled={analyzingCustom === key}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium text-xs">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.schemeCode || item.symbol}</p>
                        </div>
                        {analyzingCustom === key ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
                        ) : alreadyAnalyzed ? (
                          <span className="text-xs text-green-600 flex-shrink-0 flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> Done
                          </span>
                        ) : (
                          <span className="text-xs text-primary flex-shrink-0">Analyze →</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No results found</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Progress */}
      {discoverLoading && (
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {analyzingAll ? discoverProgress.catProgress + ' — ' : ''}
              {discoverProgress.currentCat || 'Analyzing...'}
            </span>
            <span className="text-sm text-muted-foreground">{discoverProgress.current}/{discoverProgress.total}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${discoverProgress.total > 0 ? (discoverProgress.current / discoverProgress.total) * 100 : 0}%` }} />
          </div>
        </CardContent></Card>
      )}

      {/* Sort */}
      {sortedResults.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-xs border rounded-md px-2 py-1 bg-background">
            <option value="score">Sort by Score</option>
            <option value="name">Sort by Name</option>
            <option value="return1Y">Sort by 1Y Return</option>
          </select>
          <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} className="p-1 rounded hover:bg-muted">
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Results */}
      <div className="space-y-2">
        {sortedResults.length === 0 && !discoverLoading && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">
            {filterSources.length === 1 && filterSources[0] === 'portfolio' ? 'Run "My Portfolio" analysis first to see your funds here.' :
             filterSources.length === 1 && filterSources[0] === 'custom' ? 'No custom items yet. Use "Search & Add" to analyze specific funds.' :
             'Select a category or click "Analyze All" to get started.'}
          </CardContent></Card>
        )}
        {sortedResults.map(result => (
          <DiscoverCard key={result.key} result={result} expanded={expandedDiscover === result.key}
            onToggle={() => setExpandedDiscover(expandedDiscover === result.key ? null : result.key)}
            isCustom={result.isCustom}
            isPortfolio={result.isPortfolio}
            onRemove={result.isCustom ? () => {
              const updated = { ...customResults };
              delete updated[result.key];
              setCustomResults(updated);
              saveCustomDiscover(updated);
            } : null}
          />
        ))}
      </div>
    </div>
  );
}

function DiscoverCard({ result, expanded, onToggle, isCustom, isPortfolio, onRemove }) {
  const { item, score, recommendation, scores, technicals, fundamentals, riskMetrics, rollingReturns, meta, error } = result;
  if (!item) return null;

  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3">
          <ScoreCircle score={score} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{item.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                {item.type === 'mutual_fund' ? 'MF' : 'Stock'}
              </span>
              {isPortfolio && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 flex-shrink-0">
                  Owned
                </span>
              )}
              {isCustom && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 flex-shrink-0">
                  Custom
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              {rollingReturns?.return1Y != null && (
                <span className={rollingReturns.return1Y >= 0 ? 'text-green-600' : 'text-red-600'}>
                  1Y: {rollingReturns.return1Y >= 0 ? '+' : ''}{rollingReturns.return1Y}%
                </span>
              )}
              {rollingReturns?.return3M != null && (
                <span className={rollingReturns.return3M >= 0 ? 'text-green-600' : 'text-red-600'}>
                  3M: {rollingReturns.return3M >= 0 ? '+' : ''}{rollingReturns.return3M}%
                </span>
              )}
              {riskMetrics?.sharpeRatio != null && <span>Sharpe: {riskMetrics.sharpeRatio}</span>}
              {technicals?.rsi != null && <span>RSI: {technicals.rsi.toFixed(0)}</span>}
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
            style={{ backgroundColor: recommendation?.bgColor, color: recommendation?.color }}>
            {recommendation?.label || 'N/A'}
          </div>
          {onRemove && (
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors flex-shrink-0" title="Remove">
              <X className="h-3.5 w-3.5 text-red-400" />
            </button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 bg-muted/10 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950 p-3 rounded-lg">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Limited: {error}</span>
            </div>
          )}

          {scores && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <DimensionCard label={item.type === 'mutual_fund' ? 'Fund Quality' : 'Fundamental'} scoreData={scores.fundamental} icon={BarChart3} />
              <DimensionCard label="Technical" scoreData={scores.technical} icon={Activity} />
              <DimensionCard label="Risk" scoreData={scores.risk} icon={Shield} />
              <DimensionCard label="Momentum" scoreData={scores.momentum} icon={Zap} />
            </div>
          )}

          {technicals && !technicals.insufficient && (
            <DetailSection title="Technical Indicators">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <MetricRow label="RSI (14)" value={technicals.rsi?.toFixed(1)} signal={technicals.rsiSignal} />
                <MetricRow label="MACD" value={technicals.macdBullish ? 'Bullish' : 'Bearish'} signal={technicals.macdBullish ? 'positive' : 'negative'} />
                <MetricRow label="Trend" value={technicals.trendDirection} signal={technicals.trendDirection === 'uptrend' ? 'positive' : technicals.trendDirection === 'downtrend' ? 'negative' : 'neutral'} />
                <MetricRow label="52W Range" value={`${technicals.rangePosition}%`} hint={`${technicals.fiftyTwoWeekLow?.toFixed(2)} - ${technicals.fiftyTwoWeekHigh?.toFixed(2)}`} />
                <MetricRow label="From 52W High" value={`${technicals.distanceFrom52WH?.toFixed(1)}%`} signal={technicals.distanceFrom52WH > -10 ? 'positive' : 'negative'} />
                <MetricRow label="Momentum" value={technicals.momentum} signal={technicals.momentum === 'bullish' ? 'positive' : technicals.momentum === 'bearish' ? 'negative' : 'neutral'} />
              </div>
            </DetailSection>
          )}

          {fundamentals && (
            <DetailSection title="Fundamentals">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <MetricRow label="PE (Trailing)" value={fundamentals.trailingPE?.toFixed(1)} />
                <MetricRow label="PEG Ratio" value={fundamentals.pegRatio?.toFixed(2)} signal={fundamentals.pegRatio < 1 ? 'positive' : fundamentals.pegRatio > 2 ? 'negative' : 'neutral'} />
                <MetricRow label="ROE" value={fundamentals.returnOnEquity ? `${(fundamentals.returnOnEquity * 100).toFixed(1)}%` : null} />
                <MetricRow label="Debt/Equity" value={fundamentals.debtToEquity?.toFixed(1)} signal={fundamentals.debtToEquity < 50 ? 'positive' : fundamentals.debtToEquity > 150 ? 'negative' : 'neutral'} />
              </div>
              {fundamentals.targetMeanPrice && fundamentals.currentPrice && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Analyst Target: <span className="font-medium">{formatCurrency(fundamentals.targetMeanPrice)}</span>
                  <span className={`ml-2 font-medium ${fundamentals.targetMeanPrice > fundamentals.currentPrice ? 'text-green-600' : 'text-red-600'}`}>
                    ({((fundamentals.targetMeanPrice - fundamentals.currentPrice) / fundamentals.currentPrice * 100).toFixed(1)}% upside)
                  </span>
                </div>
              )}
            </DetailSection>
          )}

          {meta && (
            <DetailSection title="Fund Info">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {meta.fund_house && <MetricRow label="Fund House" value={meta.fund_house} />}
                {meta.scheme_category && <MetricRow label="Category" value={meta.scheme_category} />}
                {meta.scheme_type && <MetricRow label="Type" value={meta.scheme_type} />}
              </div>
            </DetailSection>
          )}

          {riskMetrics && !riskMetrics.insufficient && (
            <DetailSection title="Risk Metrics">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <MetricRow label="Volatility (Ann.)" value={`${riskMetrics.annualizedVolatility}%`} signal={riskMetrics.annualizedVolatility < 20 ? 'positive' : 'negative'} />
                <MetricRow label="Sharpe Ratio" value={riskMetrics.sharpeRatio?.toFixed(2)} signal={riskMetrics.sharpeRatio > 1 ? 'positive' : riskMetrics.sharpeRatio < 0 ? 'negative' : 'neutral'} />
                <MetricRow label="Max Drawdown" value={`-${riskMetrics.maxDrawdown}%`} signal={riskMetrics.maxDrawdown < 15 ? 'positive' : 'negative'} />
                <MetricRow label="Sortino Ratio" value={riskMetrics.sortinoRatio?.toFixed(2)} signal={riskMetrics.sortinoRatio > 1 ? 'positive' : 'neutral'} />
              </div>
            </DetailSection>
          )}

          {rollingReturns && Object.keys(rollingReturns).length > 0 && (
            <DetailSection title="Rolling Returns">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <MetricRow label="1 Week" value={rollingReturns.return1W != null ? `${rollingReturns.return1W}%` : null} signal={rollingReturns.return1W > 0 ? 'positive' : 'negative'} />
                <MetricRow label="1 Month" value={rollingReturns.return1M != null ? `${rollingReturns.return1M}%` : null} signal={rollingReturns.return1M > 0 ? 'positive' : 'negative'} />
                <MetricRow label="3 Months" value={rollingReturns.return3M != null ? `${rollingReturns.return3M}%` : null} signal={rollingReturns.return3M > 0 ? 'positive' : 'negative'} />
                <MetricRow label="6 Months" value={rollingReturns.return6M != null ? `${rollingReturns.return6M}%` : null} signal={rollingReturns.return6M > 0 ? 'positive' : 'negative'} />
                <MetricRow label="1 Year" value={rollingReturns.return1Y != null ? `${rollingReturns.return1Y}%` : null} signal={rollingReturns.return1Y > 0 ? 'positive' : 'negative'} />
              </div>
            </DetailSection>
          )}

          {scores && (
            <DetailSection title="Score Breakdown">
              <div className="space-y-2">
                {Object.entries(scores).map(([key, scoreData]) => {
                  if (!scoreData?.details || Object.keys(scoreData.details).length === 0) return null;
                  return (
                    <div key={key} className="text-xs">
                      <span className="font-medium capitalize">{key}:</span>
                      <span className="ml-2 text-muted-foreground">{Object.values(scoreData.details).join(' · ')}</span>
                    </div>
                  );
                })}
              </div>
            </DetailSection>
          )}
        </div>
      )}
    </Card>
  );
}

// ============================================================
// SUB-COMPONENTS (shared)
// ============================================================

function FailedFundsCard({ failedFunds }) {
  const [expanded, setExpanded] = useState(false);
  if (!failedFunds || failedFunds.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-amber-700 dark:text-amber-300 text-sm">
                {failedFunds.length} fund{failedFunds.length > 1 ? 's' : ''} could not be fully analyzed
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                Score may be inaccurate for these. Tap to {expanded ? 'hide' : 'see details'}.
              </p>
            </div>
            {expanded ? <ChevronUp className="h-4 w-4 text-amber-500" /> : <ChevronDown className="h-4 w-4 text-amber-500" />}
          </div>
        </CardContent>
      </button>
      {expanded && (
        <div className="border-t border-amber-200 dark:border-amber-800 px-4 pb-4">
          <div className="space-y-2 mt-3">
            {failedFunds.map(f => (
              <div key={f.key} className="flex items-start gap-2 text-xs">
                <XCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-amber-700 dark:text-amber-300">{f.name}</span>
                  <span className="text-amber-500 ml-1.5">
                    ({f.type === 'mutual_fund' ? 'MF' : 'Stock'}{f.symbol ? ` · ${f.symbol}` : f.schemeCode ? ` · ${f.schemeCode}` : ''})
                  </span>
                  <p className="text-amber-600/70 dark:text-amber-400/70 mt-0.5">{f.error}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function SummaryCard({ label, value, icon: Icon, color, onClick, active }) {
  const colorMap = {
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-950', green: 'text-green-600 bg-green-50 dark:bg-green-950',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950', amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950',
    orange: 'text-orange-600 bg-orange-50 dark:bg-orange-950', red: 'text-red-600 bg-red-50 dark:bg-red-950',
  };
  return (
    <Card className={`cursor-pointer transition-all ${active ? 'ring-2 ring-primary' : ''}`} onClick={onClick}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value ?? '-'}</p>
          </div>
          <div className={`p-2 rounded-lg ${colorMap[color] || ''}`}><Icon className="h-4 w-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// FUND INSIGHT CARD (portfolio)
// ============================================================

function FundInsightCard({ fund, analysis, expanded, onToggle, hideValues, portfolioValue }) {
  if (!analysis) return null;
  const { score, recommendation, scores } = analysis;
  const weight = portfolioValue > 0 ? (fund.currentValue / portfolioValue * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3">
          <ScoreCircle score={score} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{fund.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                {fund.type === 'mutual_fund' ? 'MF' : fund.type === 'stock' ? 'Stock' : fund.type}
              </span>
              {isGoldFund(fund.name) && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 flex-shrink-0">Gold</span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
              <span>{hideValues ? '***' : formatCurrency(fund.currentValue)}</span>
              <span className={fund.absoluteReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}>
                {fund.absoluteReturnPct >= 0 ? '+' : ''}{fund.absoluteReturnPct?.toFixed(1)}%
              </span>
              {fund.xirr !== null && (
                <span>XIRR: <span className={fund.xirr >= 0 ? 'text-green-600' : 'text-red-600'}>{fund.xirr?.toFixed(1)}%</span></span>
              )}
              <span>{weight.toFixed(1)}% of portfolio</span>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0" style={{ backgroundColor: recommendation.bgColor, color: recommendation.color }}>
            {recommendation.label}
          </div>
          <div className="hidden md:flex items-center gap-2 flex-shrink-0">
            {analysis.technicals && !analysis.technicals.insufficient && (
              <>
                <SignalBadge label={`RSI ${analysis.technicals.rsi?.toFixed(0) || '?'}`} signal={analysis.technicals.rsiSignal} />
                <SignalBadge label={analysis.technicals.trendDirection === 'uptrend' ? '↑ Trend' : analysis.technicals.trendDirection === 'downtrend' ? '↓ Trend' : '→ Flat'}
                  signal={analysis.technicals.trendDirection === 'uptrend' ? 'positive' : analysis.technicals.trendDirection === 'downtrend' ? 'negative' : 'neutral'} />
              </>
            )}
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 bg-muted/10 space-y-4">
          {analysis.error && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950 p-3 rounded-lg">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /><span>Analysis limited: {analysis.error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <DimensionCard label={fund.type === 'mutual_fund' ? 'Fund Quality' : 'Fundamental'} scoreData={scores.fundamental} icon={BarChart3} />
            <DimensionCard label="Technical" scoreData={scores.technical} icon={Activity} />
            <DimensionCard label="Risk" scoreData={scores.risk} icon={Shield} />
            <DimensionCard label="Momentum" scoreData={scores.momentum} icon={Zap} />
            <DimensionCard label="Personal" scoreData={scores.personal} icon={Target} />
          </div>

          {analysis.technicals && !analysis.technicals.insufficient && (
            <DetailSection title="Technical Indicators">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <MetricRow label="RSI (14)" value={analysis.technicals.rsi?.toFixed(1)} signal={analysis.technicals.rsiSignal} />
                <MetricRow label="MACD" value={analysis.technicals.macdBullish ? 'Bullish' : 'Bearish'} signal={analysis.technicals.macdBullish ? 'positive' : 'negative'} />
                <MetricRow label="Trend" value={analysis.technicals.trendDirection} signal={analysis.technicals.trendDirection === 'uptrend' ? 'positive' : analysis.technicals.trendDirection === 'downtrend' ? 'negative' : 'neutral'} />
                <MetricRow label="Trend Strength" value={analysis.technicals.trendStrength} />
                <MetricRow label="SMA 50" value={analysis.technicals.sma50?.toFixed(2)} signal={analysis.technicals.priceAboveSMA50 ? 'positive' : 'negative'} hint={analysis.technicals.priceAboveSMA50 ? 'Price above' : 'Price below'} />
                <MetricRow label="SMA 200" value={analysis.technicals.sma200?.toFixed(2)} signal={analysis.technicals.priceAboveSMA200 ? 'positive' : 'negative'} hint={analysis.technicals.priceAboveSMA200 ? 'Price above' : 'Price below'} />
                <MetricRow label="Bollinger %B" value={analysis.technicals.bollingerPercentB?.toFixed(2)} signal={analysis.technicals.bollingerPercentB > 0.8 ? 'negative' : analysis.technicals.bollingerPercentB < 0.2 ? 'positive' : 'neutral'} />
                <MetricRow label="ADX" value={analysis.technicals.adx?.toFixed(1)} hint={analysis.technicals.trendStrength} />
                <MetricRow label="52W Range" value={`${analysis.technicals.rangePosition}%`} hint={`${analysis.technicals.fiftyTwoWeekLow?.toFixed(2)} - ${analysis.technicals.fiftyTwoWeekHigh?.toFixed(2)}`} />
                <MetricRow label="From 52W High" value={`${analysis.technicals.distanceFrom52WH?.toFixed(1)}%`} signal={analysis.technicals.distanceFrom52WH > -10 ? 'positive' : 'negative'} />
                {analysis.technicals.crossSignal && (
                  <MetricRow label="Cross Signal" value={analysis.technicals.crossSignal === 'golden_cross' ? 'Golden Cross!' : 'Death Cross!'} signal={analysis.technicals.crossSignal === 'golden_cross' ? 'positive' : 'negative'} />
                )}
                <MetricRow label="Momentum" value={analysis.technicals.momentum} signal={analysis.technicals.momentum === 'bullish' ? 'positive' : analysis.technicals.momentum === 'bearish' ? 'negative' : 'neutral'} />
              </div>
            </DetailSection>
          )}

          {analysis.fundamentals && (
            <DetailSection title="Fundamentals">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <MetricRow label="PE (Trailing)" value={analysis.fundamentals.trailingPE?.toFixed(1)} />
                <MetricRow label="PE (Forward)" value={analysis.fundamentals.forwardPE?.toFixed(1)} />
                <MetricRow label="PEG Ratio" value={analysis.fundamentals.pegRatio?.toFixed(2)} signal={analysis.fundamentals.pegRatio < 1 ? 'positive' : analysis.fundamentals.pegRatio > 2 ? 'negative' : 'neutral'} />
                <MetricRow label="Price/Book" value={analysis.fundamentals.priceToBook?.toFixed(2)} />
                <MetricRow label="ROE" value={analysis.fundamentals.returnOnEquity ? `${(analysis.fundamentals.returnOnEquity * 100).toFixed(1)}%` : null} signal={analysis.fundamentals.returnOnEquity > 0.15 ? 'positive' : 'neutral'} />
                <MetricRow label="ROA" value={analysis.fundamentals.returnOnAssets ? `${(analysis.fundamentals.returnOnAssets * 100).toFixed(1)}%` : null} />
                <MetricRow label="Debt/Equity" value={analysis.fundamentals.debtToEquity?.toFixed(1)} signal={analysis.fundamentals.debtToEquity < 50 ? 'positive' : analysis.fundamentals.debtToEquity > 150 ? 'negative' : 'neutral'} />
                <MetricRow label="Current Ratio" value={analysis.fundamentals.currentRatio?.toFixed(2)} signal={analysis.fundamentals.currentRatio > 1.5 ? 'positive' : analysis.fundamentals.currentRatio < 1 ? 'negative' : 'neutral'} />
                <MetricRow label="Revenue Growth" value={analysis.fundamentals.revenueGrowth ? `${(analysis.fundamentals.revenueGrowth * 100).toFixed(1)}%` : null} signal={analysis.fundamentals.revenueGrowth > 0 ? 'positive' : 'negative'} />
                <MetricRow label="Earnings Growth" value={analysis.fundamentals.earningsGrowth ? `${(analysis.fundamentals.earningsGrowth * 100).toFixed(1)}%` : null} signal={analysis.fundamentals.earningsGrowth > 0 ? 'positive' : 'negative'} />
                <MetricRow label="Profit Margin" value={analysis.fundamentals.profitMargins ? `${(analysis.fundamentals.profitMargins * 100).toFixed(1)}%` : null} />
                <MetricRow label="Dividend Yield" value={analysis.fundamentals.dividendYield ? `${(analysis.fundamentals.dividendYield * 100).toFixed(2)}%` : null} />
                <MetricRow label="Beta" value={analysis.fundamentals.beta?.toFixed(2)} signal={analysis.fundamentals.beta > 1.3 ? 'negative' : analysis.fundamentals.beta < 0.8 ? 'positive' : 'neutral'} />
                <MetricRow label="Market Cap" value={analysis.fundamentals.marketCap ? formatLargeNum(analysis.fundamentals.marketCap) : null} />
                {analysis.fundamentals.sector && <MetricRow label="Sector" value={analysis.fundamentals.sector} />}
                {analysis.fundamentals.industry && <MetricRow label="Industry" value={analysis.fundamentals.industry} />}
              </div>
              {analysis.fundamentals.recommendationKey && (
                <div className="mt-3 p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">Analyst Consensus:</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${analysis.fundamentals.recommendationKey === 'buy' || analysis.fundamentals.recommendationKey === 'strong_buy' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : analysis.fundamentals.recommendationKey === 'sell' || analysis.fundamentals.recommendationKey === 'strong_sell' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}`}>
                        {analysis.fundamentals.recommendationKey.toUpperCase()}
                      </span>
                      <span className="text-xs text-muted-foreground">({analysis.fundamentals.numberOfAnalystOpinions} analysts)</span>
                    </div>
                    {analysis.fundamentals.targetMeanPrice && (
                      <div className="text-xs">
                        Target: <span className="font-medium">{formatCurrency(analysis.fundamentals.targetMeanPrice)}</span>
                        <span className="text-muted-foreground ml-1">({formatCurrency(analysis.fundamentals.targetLowPrice)} - {formatCurrency(analysis.fundamentals.targetHighPrice)})</span>
                        {analysis.fundamentals.currentPrice && (
                          <span className={`ml-2 font-medium ${analysis.fundamentals.targetMeanPrice > analysis.fundamentals.currentPrice ? 'text-green-600' : 'text-red-600'}`}>
                            {((analysis.fundamentals.targetMeanPrice - analysis.fundamentals.currentPrice) / analysis.fundamentals.currentPrice * 100).toFixed(1)}% upside
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {(analysis.fundamentals.analystStrongBuy > 0 || analysis.fundamentals.analystBuy > 0 || analysis.fundamentals.analystHold > 0 || analysis.fundamentals.analystSell > 0) && (
                    <AnalystBar strongBuy={analysis.fundamentals.analystStrongBuy} buy={analysis.fundamentals.analystBuy} hold={analysis.fundamentals.analystHold} sell={analysis.fundamentals.analystSell} strongSell={analysis.fundamentals.analystStrongSell} />
                  )}
                </div>
              )}
            </DetailSection>
          )}

          {analysis.meta && (
            <DetailSection title="Fund Info">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {analysis.meta.fund_house && <MetricRow label="Fund House" value={analysis.meta.fund_house} />}
                {analysis.meta.scheme_category && <MetricRow label="Category" value={analysis.meta.scheme_category} />}
                {analysis.meta.scheme_type && <MetricRow label="Type" value={analysis.meta.scheme_type} />}
              </div>
            </DetailSection>
          )}

          {analysis.riskMetrics && !analysis.riskMetrics.insufficient && (
            <DetailSection title="Risk Metrics">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <MetricRow label="Volatility (Ann.)" value={`${analysis.riskMetrics.annualizedVolatility}%`} signal={analysis.riskMetrics.annualizedVolatility < 20 ? 'positive' : 'negative'} />
                <MetricRow label="Sharpe Ratio" value={analysis.riskMetrics.sharpeRatio?.toFixed(2)} signal={analysis.riskMetrics.sharpeRatio > 1 ? 'positive' : analysis.riskMetrics.sharpeRatio < 0 ? 'negative' : 'neutral'} />
                <MetricRow label="Sortino Ratio" value={analysis.riskMetrics.sortinoRatio?.toFixed(2)} signal={analysis.riskMetrics.sortinoRatio > 1 ? 'positive' : 'neutral'} />
                <MetricRow label="Max Drawdown" value={`-${analysis.riskMetrics.maxDrawdown}%`} signal={analysis.riskMetrics.maxDrawdown < 15 ? 'positive' : 'negative'} />
                <MetricRow label="VaR (95%)" value={`${analysis.riskMetrics.var95}%`} />
                {analysis.riskMetrics.beta !== null && <MetricRow label="Beta" value={analysis.riskMetrics.beta?.toFixed(2)} />}
                {analysis.riskMetrics.alpha !== null && <MetricRow label="Alpha" value={`${analysis.riskMetrics.alpha}%`} signal={analysis.riskMetrics.alpha > 0 ? 'positive' : 'negative'} />}
                {analysis.riskMetrics.rSquared !== null && <MetricRow label="R²" value={`${analysis.riskMetrics.rSquared}%`} />}
              </div>
            </DetailSection>
          )}

          {analysis.rollingReturns && Object.keys(analysis.rollingReturns).length > 0 && (
            <DetailSection title="Rolling Returns">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <MetricRow label="1 Week" value={analysis.rollingReturns.return1W !== null ? `${analysis.rollingReturns.return1W}%` : null} signal={analysis.rollingReturns.return1W > 0 ? 'positive' : analysis.rollingReturns.return1W < 0 ? 'negative' : 'neutral'} />
                <MetricRow label="1 Month" value={analysis.rollingReturns.return1M !== null ? `${analysis.rollingReturns.return1M}%` : null} signal={analysis.rollingReturns.return1M > 0 ? 'positive' : 'negative'} />
                <MetricRow label="3 Months" value={analysis.rollingReturns.return3M !== null ? `${analysis.rollingReturns.return3M}%` : null} signal={analysis.rollingReturns.return3M > 0 ? 'positive' : 'negative'} />
                <MetricRow label="6 Months" value={analysis.rollingReturns.return6M !== null ? `${analysis.rollingReturns.return6M}%` : null} signal={analysis.rollingReturns.return6M > 0 ? 'positive' : 'negative'} />
                <MetricRow label="1 Year" value={analysis.rollingReturns.return1Y !== null ? `${analysis.rollingReturns.return1Y}%` : null} signal={analysis.rollingReturns.return1Y > 0 ? 'positive' : 'negative'} />
              </div>
              {analysis.rollingReturns.consistency !== null && (
                <div className="mt-2 text-xs text-muted-foreground">Rolling 1Y consistency: <span className="font-medium">{analysis.rollingReturns.consistency}%</span> of periods positive</div>
              )}
            </DetailSection>
          )}

          <DetailSection title="Score Breakdown">
            <div className="space-y-2">
              {Object.entries(scores).map(([key, scoreData]) => {
                if (!scoreData?.details || Object.keys(scoreData.details).length === 0) return null;
                return (
                  <div key={key} className="text-xs">
                    <span className="font-medium capitalize">{key}:</span>
                    <span className="ml-2 text-muted-foreground">{Object.values(scoreData.details).join(' · ')}</span>
                  </div>
                );
              })}
            </div>
          </DetailSection>
        </div>
      )}
    </Card>
  );
}

// ============================================================
// TOOLTIP POPOVER (shared context so only one open at a time)
// ============================================================

const TooltipContext = createContext({ openLabel: null, setOpenLabel: () => {} });

function TooltipProvider({ children }) {
  const [openLabel, setOpenLabel] = useState(null);
  return (
    <TooltipContext.Provider value={{ openLabel, setOpenLabel }}>
      {/* Clicking anywhere outside closes the tooltip */}
      <div onClick={() => setOpenLabel(null)}>
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

function InfoTooltip({ label }) {
  const tip = getTooltip(label);
  const btnRef = useRef(null);
  const popoverRef = useRef(null);
  const { openLabel, setOpenLabel } = useContext(TooltipContext);
  const isOpen = openLabel === label;

  // Position the popover above the button
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const popoverWidth = 280;
      // Place above the icon, centered horizontally
      let left = rect.left + rect.width / 2 - popoverWidth / 2;
      // Keep within viewport
      if (left < 8) left = 8;
      if (left + popoverWidth > window.innerWidth - 8) left = window.innerWidth - popoverWidth - 8;
      // If not enough space above, place below
      const spaceAbove = rect.top;
      const placeBelow = spaceAbove < 120;
      const top = placeBelow ? rect.bottom + 6 : rect.top - 6;
      setPos({ top, left, placeBelow });
    }
  }, [isOpen]);

  if (!tip) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpenLabel(isOpen ? null : label); }}
        className="ml-1 inline-flex items-center text-muted-foreground/60 hover:text-primary transition-colors"
      >
        <HelpCircle className="h-3 w-3" />
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="fixed z-[100] w-[280px] bg-background border rounded-lg shadow-lg p-3 animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: pos.placeBelow ? pos.top : 'auto',
            bottom: pos.placeBelow ? 'auto' : `${window.innerHeight - pos.top}px`,
            left: pos.left,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="font-semibold text-xs text-primary">{label}</h4>
            <button onClick={(e) => { e.stopPropagation(); setOpenLabel(null); }} className="p-0.5 rounded hover:bg-muted flex-shrink-0">
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{tip}</p>
          {/* Arrow */}
          <div className={`absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-background border rotate-45 ${
            pos.placeBelow ? '-top-[5px] border-b-0 border-r-0' : '-bottom-[5px] border-t-0 border-l-0'
          }`} />
        </div>
      )}
    </>
  );
}

// ============================================================
// SHARED SUB-COMPONENTS
// ============================================================

function ScoreCircle({ score, size = 40 }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? '#16a34a' : score >= 62 ? '#22c55e' : score >= 48 ? '#f59e0b' : score >= 35 ? '#f97316' : '#dc2626';
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-500" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

function DimensionCard({ label, scoreData, icon: Icon }) {
  if (!scoreData) return null;
  const { score, label: scoreLabel } = scoreData;
  const color = score >= 65 ? 'text-green-600' : score >= 45 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="p-3 rounded-lg bg-muted/30 border">
      <div className="flex items-center gap-1 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{label}</span>
        <InfoTooltip label={label} />
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-lg font-bold ${color}`}>{score}</span>
        <span className="text-xs text-muted-foreground">{scoreLabel}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-1 mt-1.5">
        <div className={`h-1 rounded-full transition-all ${score >= 65 ? 'bg-green-500' : score >= 45 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <div>
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">{title}</h4>
      {children}
    </div>
  );
}

function MetricRow({ label, value, signal, hint }) {
  const signalColors = { positive: 'text-green-600', negative: 'text-red-600', neutral: 'text-foreground', overbought: 'text-red-500', oversold: 'text-green-500' };
  if (value === null || value === undefined) {
    return (
      <div className="p-2 rounded bg-muted/20">
        <div className="text-muted-foreground flex items-center">{label}<InfoTooltip label={label} /></div>
        <div className="font-medium text-muted-foreground/50">N/A</div>
      </div>
    );
  }
  return (
    <div className="p-2 rounded bg-muted/20">
      <div className="text-muted-foreground flex items-center">{label}<InfoTooltip label={label} /></div>
      <div className={`font-medium ${signalColors[signal] || 'text-foreground'}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function SignalBadge({ label, signal }) {
  const colors = {
    positive: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    negative: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    neutral: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    overbought: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    oversold: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[signal] || colors.neutral}`}>{label}</span>;
}

function AnalystBar({ strongBuy, buy, hold, sell, strongSell }) {
  const total = strongBuy + buy + hold + sell + strongSell;
  if (total === 0) return null;
  const segments = [
    { value: strongBuy, color: 'bg-green-600', label: `Strong Buy (${strongBuy})` },
    { value: buy, color: 'bg-green-400', label: `Buy (${buy})` },
    { value: hold, color: 'bg-amber-400', label: `Hold (${hold})` },
    { value: sell, color: 'bg-orange-400', label: `Sell (${sell})` },
    { value: strongSell, color: 'bg-red-500', label: `Strong Sell (${strongSell})` },
  ].filter(s => s.value > 0);
  return (
    <div className="mt-2">
      <div className="flex h-3 rounded-full overflow-hidden">
        {segments.map((seg, i) => <div key={i} className={`${seg.color} transition-all`} style={{ width: `${(seg.value / total) * 100}%` }} title={seg.label} />)}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        {segments.map((seg, i) => <span key={i}>{seg.label}</span>)}
      </div>
    </div>
  );
}

function formatLargeNum(num) {
  if (!num) return 'N/A';
  if (num >= 1e12) return `₹${(num / 1e12).toFixed(1)}T`;
  if (num >= 1e9) return `₹${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e7) return `₹${(num / 1e7).toFixed(1)}Cr`;
  if (num >= 1e5) return `₹${(num / 1e5).toFixed(1)}L`;
  return formatCurrency(num);
}

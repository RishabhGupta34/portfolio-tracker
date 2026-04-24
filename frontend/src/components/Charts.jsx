import { useState, useEffect, useMemo } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCurrency, formatDate, formatCurrencyCompact, formatNumber } from '../lib/utils';
import { TrendingUp, PieChart as PieChartIcon, BarChart3, Filter, Eye, EyeOff, TrendingDown, Activity, DollarSign, Calendar, Bell, ChevronDown, X } from 'lucide-react';
import { AnimatedCard } from './ui/AnimatedCard';
import { getBenchmarkPrice, calculateBenchmarkTimeline, getAvailableBenchmarks } from '../lib/benchmark';
import { matchesTypeFilter, isGoldFund } from '../lib/fundUtils';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export function Charts() {
  const [timeline, setTimeline] = useState([]);
  const [allocation, setAllocation] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [assetAllocation, setAssetAllocation] = useState([]);
  const [topPerformers, setTopPerformers] = useState({ top: [], worst: [] });
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]); // Multi-select: array of account IDs
  const [selectedTypes, setSelectedTypes] = useState([]); // Multi-select: array of types
  const [hideValues, setHideValues] = useState(false);
  const [timeRange, setTimeRange] = useState('30D');
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [selectedBenchmark, setSelectedBenchmark] = useState('Nifty 50');
  const [benchmarkData, setBenchmarkData] = useState([]);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [expandedAccount, setExpandedAccount] = useState(null);
  const [accountTransactions, setAccountTransactions] = useState({});

  useEffect(() => {
    loadChartData();
    loadAccounts();
    loadNotifications();
    loadAccountTransactions();
  }, []);

  const loadAccountTransactions = async () => {
    try {
      const fundsResponse = await portfolioApi.getFunds();
      const transactionsByAccount = {};
      
      if (fundsResponse.data && Array.isArray(fundsResponse.data)) {
        fundsResponse.data.forEach(fund => {
          if (fund.transactions && Array.isArray(fund.transactions)) {
            fund.transactions.forEach(txn => {
              const accountId = fund.account_id;
              if (!transactionsByAccount[accountId]) {
                transactionsByAccount[accountId] = [];
              }
              transactionsByAccount[accountId].push({
                ...txn,
                fundName: fund.name,
                fundType: fund.type,
                fundId: fund.id
              });
            });
          }
        });
      }
      
      // Sort transactions by date (newest first) for each account
      Object.keys(transactionsByAccount).forEach(accountId => {
        transactionsByAccount[accountId].sort((a, b) => new Date(b.date) - new Date(a.date));
      });
      
      setAccountTransactions(transactionsByAccount);
    } catch (error) {
      console.error('Failed to load account transactions:', error);
    }
  };

  useEffect(() => {
    if (showBenchmark && timeline.length > 0) {
      loadBenchmarkData();
    }
  }, [showBenchmark, selectedBenchmark, timeline]);

  const loadNotifications = async () => {
    try {
      const dashboardRes = await portfolioApi.getDashboard();
      const portfolio = dashboardRes.data.portfolio_metrics;
      const funds = dashboardRes.data.fund_metrics || [];
      
      const newNotifications = [];
      
      // Portfolio value milestones
      if (portfolio.current_value >= 1000000) {
        newNotifications.push({
          id: 'milestone-10L',
          title: '🎉 Milestone Achieved!',
          message: `Your portfolio crossed ₹10 Lakhs!`,
          time: 'Just now',
          read: false
        });
      }
      
      // Day change alerts
      if (portfolio.day_change) {
        const dayChangePct = portfolio.day_change_pct || 0;
        if (Math.abs(dayChangePct) > 2) {
          newNotifications.push({
            id: 'day-change',
            title: dayChangePct > 0 ? '📈 Big Gain Today!' : '📉 Significant Drop',
            message: `Portfolio ${dayChangePct > 0 ? 'gained' : 'dropped'} ${Math.abs(dayChangePct).toFixed(2)}% today`,
            time: 'Today',
            read: false
          });
        }
      }
      
      // Top performer alerts
      const topPerformers = funds
        .filter(f => f.metrics.absolute_return_pct > 20)
        .slice(0, 3);
      
      topPerformers.forEach((fund) => {
        newNotifications.push({
          id: `top-performer-${fund.fund.id}`,
          title: '🏆 Top Performer',
          message: `${fund.fund.name} is up ${fund.metrics.absolute_return_pct.toFixed(2)}%`,
          time: 'Today',
          read: false
        });
      });
      
      // XIRR milestone
      if (portfolio.xirr && portfolio.xirr > 15) {
        newNotifications.push({
          id: 'xirr-milestone',
          title: '✨ Excellent Returns!',
          message: `Your portfolio XIRR is ${portfolio.xirr.toFixed(2)}%`,
          time: 'Today',
          read: false
        });
      }
      
      setNotifications(newNotifications.slice(0, 10));
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  const loadBenchmarkData = async () => {
    if (!timeline || timeline.length === 0) return;
    
    setBenchmarkLoading(true);
    try {
      // Get current benchmark price
      const benchmarkPrice = await getBenchmarkPrice(selectedBenchmark);
      
      // Calculate benchmark timeline aligned with portfolio timeline (now async)
      const benchmarkTimeline = await calculateBenchmarkTimeline(
        timeline,
        selectedBenchmark,
        benchmarkPrice.price
      );
      
      setBenchmarkData(benchmarkTimeline);
    } catch (error) {
      console.error('Failed to load benchmark data:', error);
      // Fallback: use simplified model
      const currentPrice = timeline[timeline.length - 1]?.value || 10000;
      const benchmarkTimeline = await calculateBenchmarkTimeline(
        timeline,
        selectedBenchmark,
        currentPrice * 0.8 // Estimate benchmark at 80% of current portfolio value
      );
      setBenchmarkData(benchmarkTimeline);
    } finally {
      setBenchmarkLoading(false);
    }
  };

  useEffect(() => {
    // Reload timeline when filters change
    loadTimeline();
  }, [selectedAccounts, selectedTypes]);

  // Filter timeline by time range
  const filteredTimeline = useMemo(() => {
    if (!timeline || timeline.length === 0) return [];
    
    const now = new Date();
    let startDate = new Date();
    
    switch(timeRange) {
      case '7D':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30D':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90D':
        startDate.setDate(now.getDate() - 90);
        break;
      case '1M':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case '3M':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case '6M':
        startDate.setMonth(now.getMonth() - 6);
        break;
      case '1Y':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'ALL':
      default:
        return timeline;
    }
    
    return timeline.filter(item => {
      const itemDate = new Date(item.date);
      return itemDate >= startDate;
    });
  }, [timeline, timeRange]);

  const loadAccounts = async () => {
    try {
      const response = await portfolioApi.getAccounts();
      setAccounts(response.data);
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
  };

  const displayValue = (value) => {
    return hideValues ? '••••••' : formatCurrency(value);
  };

  const loadTimeline = async () => {
    try {
      // For multi-select, fetch all data and filter client-side
      const accountId = selectedAccounts.length === 1 ? selectedAccounts[0] : (selectedAccounts.length > 1 ? null : null);
      const fundType = selectedTypes.length === 1 ? selectedTypes[0] : (selectedTypes.length > 1 ? null : null);
      const timelineRes = await portfolioApi.getPortfolioTimeline(accountId || null, fundType || null);
      setTimeline(timelineRes.data.timeline || []);
    } catch (error) {
      console.error('Error loading timeline:', error);
    }
  };

  const loadChartData = async () => {
    try {
      // Fetch all data, filter client-side for multi-select
      const accountId = selectedAccounts.length === 1 ? selectedAccounts[0] : null;
      const fundType = selectedTypes.length === 1 ? selectedTypes[0] : null;
      const [timelineRes, allocationRes, performanceRes, assetRes, topRes, fundsRes] = await Promise.all([
        portfolioApi.getPortfolioTimeline(accountId || null, fundType || null),
        portfolioApi.getAccountAllocation(),
        portfolioApi.getFundPerformance(),
        portfolioApi.getAssetTypeAllocation(),
        portfolioApi.getTopPerformers(),
        portfolioApi.getFunds(),
      ]);
      
      setTimeline(timelineRes.data.timeline || []);
      setAllocation(allocationRes.data.allocations || []);
      setPerformance(performanceRes.data.performances || []);
      setAssetAllocation(assetRes.data.allocations || []);
      setTopPerformers({
        top: topRes.data.top_performers || [],
        worst: topRes.data.worst_performers || []
      });
      setFunds(fundsRes.data || []);
    } catch (error) {
      console.error('Error loading chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTypeName = (type) => {
    const typeNames = {
      'mutual_fund': 'Mutual Funds',
      'stock': 'Stocks',
      'fd': 'Fixed Deposits',
      'ppf': 'PPF',
      'gold': 'Gold/Silver',
      'other': 'Other'
    };
    return typeNames[type] || type;
  };

  // Filter all data based on selected account and type (multi-select)
  const filteredData = useMemo(() => {
    // Filter performance - exclude deposits (FD, PPF, EPF)
    let filteredPerf = performance.filter(p => !['fd', 'ppf', 'epf'].includes(p.type));
    
    // Multi-select account filter
    if (selectedAccounts.length > 0) {
      const accountFundNames = funds
        .filter(f => selectedAccounts.includes(f.account_id) && !['fd', 'ppf', 'epf'].includes(f.type))
        .map(f => f.name);
      filteredPerf = filteredPerf.filter(p => accountFundNames.includes(p.name));
    }
    
    // Multi-select type filter (supports gold keyword detection)
    if (selectedTypes.length > 0) {
      filteredPerf = filteredPerf.filter(p => {
        const fund = funds.find(f => f.name === p.name);
        return fund ? selectedTypes.some(type => matchesTypeFilter(fund, type)) : selectedTypes.includes(p.type);
      });
    }

    // Filter allocation - recalculate based on type filter
    let filteredAlloc = allocation;
    // Multi-select account filter
    if (selectedAccounts.length > 0) {
      filteredAlloc = filteredAlloc.filter(a => {
        const account = accounts.find(acc => acc.name === a.name);
        return account && selectedAccounts.includes(account.id);
      });
    }
    
    // Always exclude deposits from allocation
    filteredAlloc = filteredAlloc.map(alloc => {
      const account = accounts.find(a => a.name === alloc.name);
      if (!account) return alloc;
      
      // Recalculate without deposits
      const accountFunds = funds.filter(f => 
        f.account_id === account.id && 
        !['fd', 'ppf', 'epf'].includes(f.type)
      );
      
      let totalValue = 0;
      let totalInvested = 0;
      accountFunds.forEach(fund => {
        const fundPerf = performance.find(p => p.name === fund.name);
        if (fundPerf) {
          totalValue += fundPerf.current_value || 0;
          totalInvested += fundPerf.invested || 0;
        }
      });
      
      return {
        name: alloc.name,
        value: totalValue,
        invested: totalInvested,
        returns: totalValue - totalInvested
      };
    }).filter(a => a.value > 0);
    
    // Multi-select type filter - further filter account allocation
    if (selectedTypes.length > 0) {
      const accountMap = new Map();
      funds.forEach(fund => {
        if (selectedTypes.some(type => matchesTypeFilter(fund, type)) && !['fd', 'ppf', 'epf'].includes(fund.type)) {
          const account = accounts.find(a => a.id === fund.account_id);
          if (account) {
            if (!accountMap.has(account.name)) {
              accountMap.set(account.name, { value: 0, invested: 0, returns: 0 });
            }
            // Find this fund in performance data
            const fundPerf = performance.find(p => p.name === fund.name);
            if (fundPerf) {
              const data = accountMap.get(account.name);
              data.value += fundPerf.current_value || 0;
              data.invested += fundPerf.invested || 0;
              data.returns += fundPerf.returns || 0;
            }
          }
        }
      });
      
      filteredAlloc = Array.from(accountMap.entries()).map(([name, data]) => ({
        name,
        value: data.value,
        invested: data.invested,
        returns: data.returns
      })).filter(a => a.value > 0);
    }

    // Filter asset allocation - exclude deposits but DON'T apply type filter (show all)
    // User requested: pie chart can ignore the filter
    let filteredAsset = assetAllocation.filter(a => !['Fixed Deposits', 'PPF', 'EPF'].includes(a.name));
    // Note: Not applying type filter - showing all asset types for pie chart

    // Filter top performers - exclude deposits but DON'T apply account/type filters (show all)
    // User requested: "best worst performer, its list - the pie chart can ignore the filter"
    let filteredTop = topPerformers.top.filter(p => !['fd', 'ppf', 'epf'].includes(p.type));
    let filteredWorst = topPerformers.worst.filter(p => !['fd', 'ppf', 'epf'].includes(p.type));
    // Note: Not applying account/type filters - showing all funds for best/worst performers

    return {
      performance: filteredPerf,
      allocation: filteredAlloc,
      assetAllocation: filteredAsset,
      topPerformers: { top: filteredTop, worst: filteredWorst }
    };
  }, [performance, allocation, assetAllocation, topPerformers, selectedAccounts, selectedTypes, funds, accounts]);

  const investmentTypes = useMemo(() => {
    const types = new Set();
    performance.forEach(p => {
      types.add(p.type);
      // Add 'gold' type if fund name contains gold keyword
      const fund = funds.find(f => f.name === p.name);
      if (fund && isGoldFund(fund.name)) {
        types.add('gold');
      }
    });
    return Array.from(types);
  }, [performance, funds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading charts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">Portfolio Analytics</h2>
            <p className="text-sm text-muted-foreground mt-1">Visualize your investment performance</p>
          </div>
          <button
            onClick={() => setHideValues(!hideValues)}
            className="p-2 rounded-md hover:bg-muted transition-colors"
            title={hideValues ? "Show values" : "Hide values"}
          >
            {hideValues ? (
              <EyeOff className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Eye className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        </div>
        
        <div className="flex flex-col gap-3 w-full sm:w-auto">
          {/* Account Filter Chips - Multi-select */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Account:</span>
            {(selectedAccounts.length > 0 || selectedTypes.length > 0) && (
              <button
                onClick={() => {
                  setSelectedAccounts([]);
                  setSelectedTypes([]);
                }}
                className="px-2 py-1 rounded-full text-xs font-medium transition-all bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-400 flex items-center gap-1"
                title="Clear all filters"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
            {accounts.map((account) => {
              const isSelected = selectedAccounts.includes(account.id);
              return (
                <div key={account.id} className="relative">
                  <button
                    onClick={() => {
                      // Toggle account selection (multi-select)
                      if (isSelected) {
                        setSelectedAccounts(prev => prev.filter(id => id !== account.id));
                      } else {
                        setSelectedAccounts(prev => [...prev, account.id]);
                      }
                      // Toggle account expansion for transaction view
                      if (expandedAccount === account.id) {
                        setExpandedAccount(null);
                      } else if (!isSelected) {
                        setExpandedAccount(account.id);
                      } else {
                        setExpandedAccount(null);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    }`}
                  >
                    {account.name}
                    {isSelected && <X className="h-3 w-3" />}
                    {expandedAccount === account.id && !isSelected && (
                      <ChevronDown className="h-3 w-3 rotate-180" />
                    )}
                  </button>
                  
                  {/* Expandable Transaction Breakdown */}
                  {expandedAccount === account.id && accountTransactions[account.id] && (
                    <div className="absolute top-full left-0 mt-2 z-50 w-96 max-h-96 overflow-y-auto bg-card border border-border rounded-lg shadow-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold text-sm">{account.name} - Transactions</h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedAccount(null);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          ×
                        </button>
                      </div>
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {accountTransactions[account.id].length > 0 ? (
                          accountTransactions[account.id].map((txn, idx) => (
                            <div
                              key={idx}
                              className="p-2 bg-muted/50 rounded-lg text-xs border border-border/50"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium">{txn.fundName}</span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  txn.transaction_type === 'buy' 
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                                    : txn.transaction_type === 'sell'
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                                }`}>
                                  {txn.transaction_type.toUpperCase()}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                                <div>
                                  <span className="text-xs">Date: </span>
                                  <span className="font-medium">{formatDate(txn.date)}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-xs">Amount: </span>
                                  <span className="font-semibold">{formatCurrency(txn.amount)}</span>
                                </div>
                                <div>
                                  <span className="text-xs">Units: </span>
                                  <span className="font-medium">{formatNumber(txn.units, 4)}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-xs">NAV: </span>
                                  <span className="font-medium">₹{formatNumber(txn.nav, 2)}</span>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-4">
                            No transactions found for this account
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Type Filter Chips - Multi-select */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type:</span>
            {investmentTypes.map((type) => {
              const isSelected = selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedTypes(prev => prev.filter(t => t !== type));
                    } else {
                      setSelectedTypes(prev => [...prev, type]);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1 ${
                    isSelected
                      ? 'bg-green-600 text-white shadow-md'
                      : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                  }`}
                >
                  {formatTypeName(type)}
                  {isSelected && <X className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Active Filters Badge */}
      {(selectedAccounts.length > 0 || selectedTypes.length > 0) && (
        <div className="flex gap-2 items-center text-sm">
          <span className="text-muted-foreground">Filtered by:</span>
          {selectedAccounts.map(accountId => (
            <span key={accountId} className="px-3 py-1 bg-primary/10 text-primary rounded-full">
              {accounts.find(a => a.id === accountId)?.name}
            </span>
          ))}
          {selectedTypes.map(type => (
            <span key={type} className="px-3 py-1 bg-primary/10 text-primary rounded-full">
              {formatTypeName(type)}
            </span>
          ))}
          <button
            onClick={() => {
              setSelectedAccounts([]);
              setSelectedTypes([]);
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Key Metrics Summary */}
      {timeline.length > 0 && (
        <div className="grid gap-4 md:grid-cols-4">
          <AnimatedCard delay={0} className="border-0 bg-gradient-to-br from-blue-500/10 to-blue-600/5 hover:shadow-lg transition-all">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Return</CardTitle>
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">
                {displayValue(timeline[timeline.length - 1]?.returns || 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {hideValues ? '••%' : `${((timeline[timeline.length - 1]?.returns_pct || 0)).toFixed(2)}%`} overall
              </p>
            </CardContent>
          </AnimatedCard>

          <AnimatedCard delay={0.1} className="border-0 bg-gradient-to-br from-green-500/10 to-green-600/5 hover:shadow-lg transition-all">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Best Performer</CardTitle>
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-green-600 truncate">
                {filteredData.topPerformers.top[0]?.name || 'N/A'}
              </div>
              <p className="text-xs text-green-600 mt-2">
                {filteredData.topPerformers.top[0] ? `+${filteredData.topPerformers.top[0].returns_pct.toFixed(2)}%` : '-'}
              </p>
            </CardContent>
          </AnimatedCard>

          <AnimatedCard delay={0.2} className="border-0 bg-gradient-to-br from-red-500/10 to-red-600/5 hover:shadow-lg transition-all">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Worst Performer</CardTitle>
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-red-600 truncate">
                {filteredData.topPerformers.worst[0]?.name || 'N/A'}
              </div>
              <p className="text-xs text-red-600 mt-2">
                {filteredData.topPerformers.worst[0] ? `${filteredData.topPerformers.worst[0].returns_pct.toFixed(2)}%` : '-'}
              </p>
            </CardContent>
          </AnimatedCard>

          <AnimatedCard delay={0.3} className="border-0 bg-gradient-to-br from-amber-500/10 to-amber-600/5 hover:shadow-lg transition-all">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Current XIRR</CardTitle>
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Activity className="h-4 w-4 text-amber-600" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-600">
                {timeline[timeline.length - 1]?.xirr !== null && timeline[timeline.length - 1]?.xirr !== undefined
                  ? `${timeline[timeline.length - 1].xirr}%`
                  : 'N/A'}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Annualized return rate
              </p>
            </CardContent>
          </AnimatedCard>
        </div>
      )}

      {/* Portfolio Value Over Time */}
      {timeline.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle>Portfolio Value Over Time</CardTitle>
              </div>
              {/* Time Range Selector */}
              <div className="flex gap-2">
                {['7D', '30D', '90D', '1M', '3M', '6M', '1Y', 'ALL'].map(range => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      timeRange === range 
                        ? 'bg-primary text-primary-foreground shadow-sm' 
                        : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {/* Benchmark Toggle */}
            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showBenchmark}
                  onChange={(e) => setShowBenchmark(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium">Show Benchmark</span>
              </label>
              {showBenchmark && (
                <select
                  value={selectedBenchmark}
                  onChange={(e) => setSelectedBenchmark(e.target.value)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {getAvailableBenchmarks().map(benchmark => (
                    <option key={benchmark} value={benchmark}>{benchmark}</option>
                  ))}
                </select>
              )}
              {benchmarkLoading && (
                <span className="text-xs text-muted-foreground">Loading benchmark...</span>
              )}
            </div>
          </CardContent>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={filteredTimeline}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => formatDate(date)}
                />
                <YAxis 
                  yAxisId="left"
                  tickFormatter={(value) => formatCurrencyCompact(value)}
                />
                <YAxis 
                  yAxisId="right" 
                  orientation="right"
                  tickFormatter={(value) => {
                    // Ensure percentage values are reasonable
                    if (value > 1000 || value < -100) return '';
                    return `${value.toFixed(1)}%`;
                  }}
                />
                <Tooltip 
                  formatter={(value, name) => {
                    if (name === 'XIRR' || name === selectedBenchmark) {
                      if (value === null || value === undefined) return 'N/A';
                      if (value > 1000 || value < -100) return 'N/A';
                      return `${value.toFixed(2)}%`;
                    }
                    return displayValue(value);
                  }}
                  labelFormatter={(date) => formatDate(date)}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.5rem',
                    color: 'hsl(var(--foreground))'
                  }}
                />
                <Legend />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="invested" 
                  stroke="#8b5cf6" 
                  name="Invested"
                  strokeWidth={2}
                  dot={false}
                />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="value" 
                  stroke="#10b981" 
                  name="Current Value"
                  strokeWidth={2}
                  dot={false}
                />
                {filteredTimeline.some(item => item.xirr !== null && item.xirr !== undefined && item.xirr >= -100 && item.xirr <= 1000) && (
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="xirr" 
                    stroke="#f59e0b" 
                    name="XIRR"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    connectNulls={true}
                  />
                )}
                {showBenchmark && benchmarkData.length > 0 && filteredTimeline.length > 0 && (
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="benchmark_return_pct" 
                    stroke="#ef4444" 
                    name={selectedBenchmark}
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    data={filteredTimeline.map((item, idx) => {
                      const benchmarkItem = benchmarkData[idx];
                      return {
                        ...item,
                        benchmark_return_pct: benchmarkItem ? benchmarkItem.return_pct : null
                      };
                    })}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Account Allocation Pie Chart */}
        {filteredData.allocation.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <PieChartIcon className="h-5 w-5 text-primary" />
                <CardTitle>Account Allocation</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={filteredData.allocation}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {filteredData.allocation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value) => displayValue(value)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem',
                      color: 'hsl(var(--foreground))'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {allocation.map((item, index) => (
                  <div key={index} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span>{item.name}</span>
                    </div>
                    <span className="font-medium">{displayValue(item.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fund Performance Bar Chart */}
        {filteredData.performance.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle>Top Performers (Returns %)</CardTitle>
              </div>
          </CardHeader>
          <CardContent className="pb-4">
            {/* Benchmark Toggle */}
            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showBenchmark}
                  onChange={(e) => setShowBenchmark(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium">Show Benchmark</span>
              </label>
              {showBenchmark && (
                <select
                  value={selectedBenchmark}
                  onChange={(e) => setSelectedBenchmark(e.target.value)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {getAvailableBenchmarks().map(benchmark => (
                    <option key={benchmark} value={benchmark}>{benchmark}</option>
                  ))}
                </select>
              )}
              {benchmarkLoading && (
                <span className="text-xs text-muted-foreground">Loading benchmark...</span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={400}>
                <BarChart data={filteredData.performance.slice(0, 5)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={150}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value, name) => {
                      if (name === 'Returns %') return hideValues ? '••%' : `${value.toFixed(2)}%`;
                      return displayValue(value);
                    }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem',
                      color: 'hsl(var(--foreground))'
                    }}
                  />
                  <Legend />
                  <Bar dataKey="returns_pct" fill="#10b981" name="Returns %" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Asset Type Allocation & Top/Worst Performers */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Asset Type Allocation */}
        {filteredData.assetAllocation.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <PieChartIcon className="h-5 w-5 text-primary" />
                <CardTitle>Asset Type Allocation</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={filteredData.assetAllocation}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {filteredData.assetAllocation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value) => displayValue(value)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '0.5rem',
                      color: 'hsl(var(--foreground))'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {filteredData.assetAllocation.map((item, index) => (
                  <div key={index} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span>{item.name} ({item.count})</span>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{displayValue(item.value)}</div>
                      <div className={`text-xs ${item.returns >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {displayValue(item.returns)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top & Worst Performers */}
        {(topPerformers.top.length > 0 || topPerformers.worst.length > 0) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle>Best & Worst Performers</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topPerformers.top.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-green-600 mb-2">🏆 Top Performers</h4>
                    <div className="space-y-2">
                      {topPerformers.top.map((fund, index) => (
                        <div key={index} className="flex justify-between items-center text-sm p-2 bg-green-100 dark:bg-green-900/30 rounded">
                          <span className="font-medium">{fund.name}</span>
                          <span className="text-green-600 dark:text-green-400 font-bold">+{fund.returns_pct.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {topPerformers.worst.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-red-600 mb-2">📉 Needs Attention</h4>
                    <div className="space-y-2">
                      {topPerformers.worst.map((fund, index) => (
                        <div key={index} className="flex justify-between items-center text-sm p-2 bg-red-100 dark:bg-red-900/30 rounded">
                          <span className="font-medium">{fund.name}</span>
                          <span className="text-red-600 dark:text-red-400 font-bold">{fund.returns_pct.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Detailed Performance Table */}
      {filteredData.performance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Detailed Fund Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium">Fund Name</th>
                    <th className="text-right p-3 font-medium">Invested</th>
                    <th className="text-right p-3 font-medium">Current Value</th>
                    <th className="text-right p-3 font-medium">Returns</th>
                    <th className="text-right p-3 font-medium">Returns %</th>
                    <th className="text-right p-3 font-medium">XIRR</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.performance.map((fund, index) => {
                    const isPositive = fund.returns >= 0;
                    return (
                      <tr key={index} className="border-b hover:bg-muted/50">
                        <td className="p-3">{fund.name}</td>
                        <td className="text-right p-3">{formatCurrency(fund.invested)}</td>
                        <td className="text-right p-3">{formatCurrency(fund.current_value)}</td>
                        <td className={`text-right p-3 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(fund.returns)}
                        </td>
                        <td className={`text-right p-3 font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {fund.returns_pct.toFixed(2)}%
                        </td>
                        <td className="text-right p-3">
                          {fund.xirr !== null ? `${fund.xirr.toFixed(2)}%` : 'N/A'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {timeline.length === 0 && allocation.length === 0 && performance.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No data for charts</h3>
            <p className="text-sm text-muted-foreground text-center">
              Add investments and transactions to see analytics
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

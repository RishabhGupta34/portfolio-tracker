import { useState, useEffect, useMemo } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { AnimatedCard, AnimatedList, AnimatedListItem } from './ui/AnimatedCard';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';
import { TrendingUp, TrendingDown, DollarSign, Wallet, Target, Activity, ChevronDown, ChevronUp, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Landmark, RefreshCw, X } from 'lucide-react';
import { Skeleton, SkeletonCard } from './ui/Skeleton';
import { toast } from './ui/Toast';
import { matchesTypeFilter, isGoldFund } from '../lib/fundUtils';
import { calculateAccountMetrics, calculateXIRR } from '../lib/calculations';
import { AssetAllocation } from './AssetAllocation';
import { InsightsSummary } from './InsightsSummary';

export function Dashboard() {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAccounts, setSelectedAccounts] = useState([]); // Multi-select: array of account IDs
  const [selectedTypes, setSelectedTypes] = useState([]); // Multi-select: array of types
  const [showFundDetails, setShowFundDetails] = useState(false);
  const [expandedFunds, setExpandedFunds] = useState(new Set());
  const [hideValues, setHideValues] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
  const [updatingAllNav, setUpdatingAllNav] = useState(false);
  const [expandedAccount, setExpandedAccount] = useState(null);
  const [accountTransactions, setAccountTransactions] = useState({});
  const [expandedAccountInFund, setExpandedAccountInFund] = useState(null); // Track expanded account within fund breakdown

  useEffect(() => {
    loadDashboard();
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

  const loadDashboard = async () => {
    try {
      const response = await portfolioApi.getDashboard();
      setDashboardData(response.data);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const displayValue = (value, formatter = formatCurrency) => {
    return hideValues ? '••••••' : formatter(value);
  };

  const handleUpdateAllNAV = async () => {
    if (!dashboardData) return;
    
    setUpdatingAllNav(true);
    const eligibleFunds = dashboardData.fund_metrics
      .map(fm => fm.fund)
      .filter(f => ['mutual_fund', 'stock'].includes(f.type));
    
    if (eligibleFunds.length === 0) {
      toast.info('No mutual funds or stocks to update');
      setUpdatingAllNav(false);
      return;
    }

    toast.info(`Updating NAV for ${eligibleFunds.length} investment(s)...`);
    
    let successCount = 0;
    let failCount = 0;

    for (const fund of eligibleFunds) {
      try {
        await portfolioApi.updateNAV(fund.id);
        successCount++;
      } catch (error) {
        console.error(`Error updating NAV for ${fund.name}:`, error);
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Updated ${successCount} investment(s)${failCount > 0 ? `, ${failCount} failed` : ''}`);
      loadDashboard();
    } else {
      toast.error('Failed to update NAV for all investments');
    }
    
    setUpdatingAllNav(false);
  };

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortConfig.direction === 'desc' 
      ? <ArrowDown className="h-3 w-3" />
      : <ArrowUp className="h-3 w-3" />;
  };

  // Filter and calculate metrics based on selections
  const filteredMetrics = useMemo(() => {
    if (!dashboardData) {
      return {
        total_invested: 0,
        current_value: 0,
        absolute_return: 0,
        absolute_return_pct: 0,
        xirr: null,
        fund_count: 0,
        fund_metrics: [],
        grouped_funds: [],
      };
    }

    // Start with a fresh copy of fund_metrics to avoid mutation issues
    let filteredFunds = [...dashboardData.fund_metrics];

    // Filter out 0-unit funds and EPF (EPF only shows in Deposits page)
    filteredFunds = filteredFunds.filter(fm => fm.metrics.current_units > 0 && fm.fund.type !== 'epf');

    // Multi-select account filter
    if (selectedAccounts.length > 0) {
      filteredFunds = filteredFunds.filter(fm => selectedAccounts.includes(fm.fund.account_id));
    }

    // Multi-select type filter (using effective type for gold detection)
    if (selectedTypes.length > 0) {
      filteredFunds = filteredFunds.filter(fm => selectedTypes.some(type => matchesTypeFilter(fm.fund, type)));
    }


    // Group funds by name and scheme_code/symbol FIRST, then sort
    const groupedFunds = filteredFunds.reduce((acc, fm) => {
      const key = `${fm.fund.name}_${fm.fund.scheme_code || fm.fund.symbol || 'other'}`;
      if (!acc[key]) {
        acc[key] = {
          name: fm.fund.name,
          type: fm.fund.type,
          scheme_code: fm.fund.scheme_code,
          symbol: fm.fund.symbol,
          current_nav: fm.fund.current_nav,
          accounts: []
        };
      }
      acc[key].accounts.push(fm);
      return acc;
    }, {});

    const groupedFundsArray = Object.values(groupedFunds).map(group => {
      // Calculate group totals
      const groupMetrics = group.accounts.reduce((sum, fm) => ({
        total_invested: sum.total_invested + fm.metrics.total_invested,
        current_value: sum.current_value + fm.metrics.current_value,
        current_units: sum.current_units + fm.metrics.current_units,
        xirr_sum: sum.xirr_sum + (fm.metrics.xirr || 0),
        xirr_count: sum.xirr_count + (fm.metrics.xirr !== null ? 1 : 0),
        day_change: sum.day_change + (fm.metrics.day_change || 0),
        day_change_count: sum.day_change_count + (fm.metrics.day_change !== null ? 1 : 0)
      }), { total_invested: 0, current_value: 0, current_units: 0, xirr_sum: 0, xirr_count: 0, day_change: 0, day_change_count: 0 });

      const absolute_return = groupMetrics.current_value - groupMetrics.total_invested;
      const absolute_return_pct = groupMetrics.total_invested > 0 
        ? (absolute_return / groupMetrics.total_invested) * 100 
        : 0;
      const avg_xirr = groupMetrics.xirr_count > 0 
        ? groupMetrics.xirr_sum / groupMetrics.xirr_count 
        : null;
      const day_change = groupMetrics.day_change_count > 0 ? groupMetrics.day_change : null;
      const day_change_pct = day_change !== null && groupMetrics.current_value > 0
        ? (day_change / (groupMetrics.current_value - day_change)) * 100
        : null;

      return {
        ...group,
        metrics: {
          total_invested: groupMetrics.total_invested,
          current_value: groupMetrics.current_value,
          current_units: groupMetrics.current_units,
          absolute_return,
          absolute_return_pct,
          xirr: avg_xirr,
          day_change,
          day_change_pct
        }
      };
    });

    // Apply sorting to grouped funds
    if (sortConfig.key) {
      groupedFundsArray.sort((a, b) => {
        let aVal, bVal;
        
        switch(sortConfig.key) {
          case 'name':
            aVal = a.name.toLowerCase();
            bVal = b.name.toLowerCase();
            break;
          case 'invested':
            aVal = a.metrics.total_invested;
            bVal = b.metrics.total_invested;
            break;
          case 'value':
            aVal = a.metrics.current_value;
            bVal = b.metrics.current_value;
            break;
          case 'returns':
            aVal = a.metrics.absolute_return;
            bVal = b.metrics.absolute_return;
            break;
          case 'returns_pct':
            aVal = a.metrics.absolute_return_pct;
            bVal = b.metrics.absolute_return_pct;
            break;
          case 'xirr':
            aVal = a.metrics.xirr || -Infinity;
            bVal = b.metrics.xirr || -Infinity;
            break;
          case 'units':
            aVal = a.metrics.current_units;
            bVal = b.metrics.current_units;
            break;
          case 'day_change':
            aVal = a.metrics.day_change !== null ? a.metrics.day_change : -Infinity;
            bVal = b.metrics.day_change !== null ? b.metrics.day_change : -Infinity;
            break;
          case 'day_change_pct':
            aVal = a.metrics.day_change_pct !== null ? a.metrics.day_change_pct : -Infinity;
            bVal = b.metrics.day_change_pct !== null ? b.metrics.day_change_pct : -Infinity;
            break;
          default:
            return 0;
        }
        
        if (typeof aVal === 'string') {
          return sortConfig.direction === 'asc' 
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Calculate aggregated metrics
    const totalInvested = filteredFunds.reduce((sum, fm) => sum + fm.metrics.total_invested, 0);
    const currentValue = filteredFunds.reduce((sum, fm) => sum + fm.metrics.current_value, 0);
    const absoluteReturn = currentValue - totalInvested;
    const absoluteReturnPct = totalInvested > 0 ? (absoluteReturn / totalInvested) * 100 : 0;

    // Calculate XIRR properly from filtered transactions
    let filteredXirr = null;
    if (filteredFunds.length > 0 && totalInvested > 0 && currentValue > 0) {
      try {
        // Collect all transactions from filtered funds
        const allTransactions = [];
        filteredFunds.forEach(fm => {
          if (fm.fund.transactions && fm.fund.transactions.length > 0) {
            allTransactions.push(...fm.fund.transactions);
          }
        });
        
        if (allTransactions.length > 0) {
          // Sort by date
          allTransactions.sort((a, b) => a.date.localeCompare(b.date));
          // Calculate XIRR using all filtered transactions
          filteredXirr = calculateXIRR(allTransactions, currentValue);
        }
      } catch (error) {
        console.warn('Failed to calculate filtered XIRR:', error);
        // Fallback to average if calculation fails
        const fundsWithXirr = filteredFunds.filter(fm => fm.metrics.xirr !== null);
        if (fundsWithXirr.length > 0) {
          filteredXirr = fundsWithXirr.reduce((sum, fm) => sum + fm.metrics.xirr, 0) / fundsWithXirr.length;
        }
      }
    }

    const result = {
      total_invested: totalInvested,
      current_value: currentValue,
      absolute_return: absoluteReturn,
      absolute_return_pct: absoluteReturnPct,
      xirr: filteredXirr,
      fund_count: filteredFunds.length,
      fund_metrics: filteredFunds,
      grouped_funds: groupedFundsArray,
    };
    
    // Removed console.log for filtered metrics (privacy)
    
    return result;
  }, [dashboardData, selectedAccounts, selectedTypes, sortConfig]);

  // Get unique accounts and types
  const accounts = useMemo(() => {
    if (!dashboardData) return [];
    return dashboardData.account_metrics.map(am => am.account);
  }, [dashboardData]);

  const investmentTypes = useMemo(() => {
    if (!dashboardData) return [];
    const types = new Set();
    
    // Check all funds for gold detection - check name, symbol, and scheme_code
    const goldFunds = dashboardData.fund_metrics.filter(fm => {
      return isGoldFund(fm.fund.name) || 
             isGoldFund(fm.fund.symbol) || 
             isGoldFund(fm.fund.scheme_code);
    });
    
    // Log for debugging
    if (goldFunds.length > 0) {
      // Removed console.log for gold fund detection (privacy)
    }
    
    // Add all original types
    dashboardData.fund_metrics.forEach(fm => {
      types.add(fm.fund.type);
    });
    
    // Add 'gold' type if any gold funds exist
    if (goldFunds.length > 0) {
      types.add('gold');
      // Removed console.log (privacy)
    }
    
    const typeArray = Array.from(types).sort();
    // Removed console.log (privacy)
    return typeArray;
  }, [dashboardData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">No data available</div>
      </div>
    );
  }

  // Always use filteredMetrics - it always returns a valid object (empty if no data)
  // This ensures metrics update immediately when filters change
  const metrics = filteredMetrics;
  const isPositive = metrics && metrics.absolute_return >= 0;

  const formatTypeName = (type) => {
    const typeNames = {
      'mutual_fund': 'Mutual Funds',
      'stock': 'Stocks',
      'private_share': 'Private Shares',
      'esop': 'ESOP / RSU',
      'fd': 'Fixed Deposits',
      'ppf': 'PPF',
      'epf': 'EPF',
      'gold': 'Gold/Silver',
      'other': 'Other'
    };
    return typeNames[type] || type;
  };

  const toggleFundExpansion = (fundId) => {
    setExpandedFunds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fundId)) {
        newSet.delete(fundId);
      } else {
        newSet.add(fundId);
      }
      return newSet;
    });
  };

  const calculateTransactionMetrics = (transactions, currentNav) => {
    return transactions.map((txn) => {
      // Individual transaction metrics
      const navToUse = currentNav || txn.nav;
      const currentValue = txn.units * navToUse;
      const invested = txn.amount;
      const returns = currentValue - invested;
      const returnsPct = invested > 0 ? (returns / invested) * 100 : 0;
      
      // Calculate XIRR for this individual transaction
      // XIRR = ((Current Value / Invested) ^ (365 / days)) - 1
      const txnDate = new Date(txn.date);
      const today = new Date();
      const daysDiff = Math.max(1, Math.floor((today - txnDate) / (1000 * 60 * 60 * 24)));
      const xirr = daysDiff > 0 ? (Math.pow(currentValue / invested, 365 / daysDiff) - 1) * 100 : 0;
      
      return {
        ...txn,
        currentValue: currentValue,
        invested: invested,
        returns: returns,
        returnsPct: returnsPct,
        xirr: xirr,
        daysSinceTransaction: daysDiff,
      };
    });
  };

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Portfolio Overview</h2>
            <p className="text-sm text-muted-foreground mt-1">Track your investments and returns</p>
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
                <button
                  key={account.id}
                  onClick={() => {
                    // Toggle account selection (multi-select)
                    if (isSelected) {
                      setSelectedAccounts(prev => prev.filter(id => id !== account.id));
                    } else {
                      setSelectedAccounts(prev => [...prev, account.id]);
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
                </button>
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

      {/* Portfolio Overview */}
      <div key={`metrics-${selectedAccounts.join(',')}-${selectedTypes.join(',')}`}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <AnimatedCard delay={0} className="border-0 bg-gradient-to-br from-blue-500/10 to-blue-600/5 hover:shadow-lg transition-all">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Invested</CardTitle>
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Wallet className="h-4 w-4 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">
                {displayValue(metrics.total_invested)}
              </div>
              {metrics.fund_count !== undefined && (
                <p className="text-xs text-muted-foreground mt-1">
                  {metrics.fund_count} investment{metrics.fund_count !== 1 ? 's' : ''}
                </p>
              )}
            </CardContent>
          </AnimatedCard>

          <AnimatedCard delay={0.1} className="border-0 bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 hover:shadow-lg transition-all">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Current Value</CardTitle>
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <Wallet className="h-4 w-4 text-indigo-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-indigo-600">
                {displayValue(metrics.current_value || 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Portfolio value
              </p>
            </CardContent>
          </AnimatedCard>

          <AnimatedCard delay={0.2} className={`border-0 bg-gradient-to-br ${isPositive ? 'from-green-500/10 to-green-600/5' : 'from-red-500/10 to-red-600/5'} hover:shadow-lg transition-all`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Absolute Return</CardTitle>
              <div className={`p-2 ${isPositive ? 'bg-green-500/20' : 'bg-red-500/20'} rounded-lg`}>
                {isPositive ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {displayValue(metrics.absolute_return || 0)}
              </div>
              <p className={`text-xs ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {hideValues ? '••' : formatNumber(metrics.absolute_return_pct || 0, 2)}%
              </p>
            </CardContent>
          </AnimatedCard>

          <AnimatedCard delay={0.3} className="border-0 bg-gradient-to-br from-purple-500/10 to-purple-600/5 hover:shadow-lg transition-all">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">XIRR</CardTitle>
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Activity className="h-4 w-4 text-purple-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">
                {hideValues ? '••' : (metrics.xirr !== null && metrics.xirr !== undefined ? `${formatNumber(metrics.xirr, 2)}%` : 'N/A')}
              </div>
              <p className="text-xs text-muted-foreground">
                Annualized return
              </p>
            </CardContent>
          </AnimatedCard>

          {dashboardData?.portfolio_metrics?.day_change !== undefined && (
            <AnimatedCard delay={0.4} className={`border-0 bg-gradient-to-br ${dashboardData.portfolio_metrics.day_change >= 0 ? 'from-emerald-500/10 to-emerald-600/5' : 'from-orange-500/10 to-orange-600/5'} hover:shadow-lg transition-all`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Day Change</CardTitle>
                <div className={`p-2 ${dashboardData.portfolio_metrics.day_change >= 0 ? 'bg-emerald-500/20' : 'bg-orange-500/20'} rounded-lg`}>
                  {dashboardData.portfolio_metrics.day_change >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-orange-600" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${dashboardData.portfolio_metrics.day_change >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                  {hideValues ? '••' : formatCurrency(dashboardData.portfolio_metrics.day_change)}
                </div>
                <p className={`text-xs ${dashboardData.portfolio_metrics.day_change >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                  {hideValues ? '••' : `${dashboardData.portfolio_metrics.day_change >= 0 ? '+' : ''}${formatNumber(dashboardData.portfolio_metrics.day_change_pct, 2)}%`}
                </p>
              </CardContent>
            </AnimatedCard>
          )}
        </div>
      </div>


      {/* Target Asset Allocation - portfolio-wide drift */}
      {dashboardData?.fund_metrics && (
        <AssetAllocation
          fundMetrics={dashboardData.fund_metrics.filter(fm => fm.metrics.current_value > 0)}
          hideValues={hideValues}
        />
      )}

      {/* Insights / X-Ray summary — surfaces deeper analysis tabs */}
      {dashboardData?.fund_metrics && (
        <InsightsSummary fundMetrics={dashboardData.fund_metrics} />
      )}

      {/* Account-wise Performance - Filtered */}
      {dashboardData.account_metrics && dashboardData.account_metrics.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Account Performance</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {dashboardData.account_metrics
              .filter(({ account }) => selectedAccounts.length === 0 || selectedAccounts.includes(account.id))
              .map(({ account }) => {
              // Calculate filtered metrics for this account
              let accountFunds = dashboardData.fund_metrics.filter(fm => 
                fm.fund.account_id === account.id && 
                fm.metrics.current_units > 0 && 
                fm.fund.type !== 'epf'
              );
              
              // Apply multi-select type filter
              if (selectedTypes.length > 0) {
                accountFunds = accountFunds.filter(fm => selectedTypes.some(type => matchesTypeFilter(fm.fund, type)));
              }
              
              // Calculate filtered account metrics (cannot use useMemo inside map - hooks must be at top level)
              const accountMetrics = (() => {
                if (accountFunds.length === 0) {
                  return {
                    total_invested: 0,
                    current_value: 0,
                    absolute_return: 0,
                    absolute_return_pct: 0,
                    xirr: null,
                    fund_count: 0,
                  };
                }
                
                const totalInvested = accountFunds.reduce((sum, fm) => sum + fm.metrics.total_invested, 0);
                const currentValue = accountFunds.reduce((sum, fm) => sum + fm.metrics.current_value, 0);
                const absoluteReturn = currentValue - totalInvested;
                const absoluteReturnPct = totalInvested > 0 ? (absoluteReturn / totalInvested) * 100 : 0;
                
                // Calculate XIRR from filtered transactions
                let accountXirr = null;
                try {
                  const allTransactions = [];
                  accountFunds.forEach(fm => {
                    if (fm.fund.transactions && fm.fund.transactions.length > 0) {
                      allTransactions.push(...fm.fund.transactions);
                    }
                  });
                  
                  if (allTransactions.length > 0 && currentValue > 0) {
                    allTransactions.sort((a, b) => a.date.localeCompare(b.date));
                    accountXirr = calculateXIRR(allTransactions, currentValue);
                  }
                } catch (error) {
                  console.warn('Failed to calculate account XIRR:', error);
                }
                
                return {
                  total_invested: totalInvested,
                  current_value: currentValue,
                  absolute_return: absoluteReturn,
                  absolute_return_pct: absoluteReturnPct,
                  xirr: accountXirr,
                  fund_count: accountFunds.length,
                };
              })();
              
              const isAccountPositive = accountMetrics.absolute_return >= 0;
              return (
                <Card key={account.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{account.name}</CardTitle>
                    {account.description && (
                      <p className="text-sm text-muted-foreground">{account.description}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Invested:</span>
                        <span className="font-medium">{displayValue(accountMetrics.total_invested)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Current:</span>
                        <span className="font-medium">{displayValue(accountMetrics.current_value)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Returns:</span>
                        <span className={`font-medium ${isAccountPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {displayValue(accountMetrics.absolute_return)} ({hideValues ? '••' : formatNumber(accountMetrics.absolute_return_pct, 2)}%)
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">XIRR:</span>
                        <span className="font-medium">
                          {accountMetrics.xirr !== null ? `${formatNumber(accountMetrics.xirr, 2)}%` : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Funds:</span>
                        <span className="font-medium">{accountMetrics.fund_count}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Fund-wise Performance */}
      {filteredMetrics && filteredMetrics.grouped_funds.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Fund Performance</h2>
          
          {/* Column Headers */}
          <div className="mb-3 px-4 py-3 bg-muted/20 rounded-lg border border-muted">
            <div className="flex items-center justify-between">
              <div className="flex-1 grid grid-cols-12 gap-2 items-center text-xs">
                <button onClick={() => handleSort('name')} className="col-span-3 flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  FUND {getSortIcon('name')}
                </button>
                <button onClick={() => handleSort('value')} className="text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  VALUE {getSortIcon('value')}
                </button>
                <button onClick={() => handleSort('invested')} className="text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  INVESTED {getSortIcon('invested')}
                </button>
                <button onClick={() => handleSort('returns')} className="text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  RETURNS {getSortIcon('returns')}
                </button>
                <button onClick={() => handleSort('returns_pct')} className="text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  RET % {getSortIcon('returns_pct')}
                </button>
                <button onClick={() => handleSort('xirr')} className="text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  XIRR {getSortIcon('xirr')}
                </button>
                <button onClick={() => handleSort('day_change')} className="col-span-2 text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  DAY CHANGE {getSortIcon('day_change')}
                </button>
                <button onClick={() => handleSort('units')} className="col-span-2 text-right flex items-center justify-end gap-1 font-semibold text-muted-foreground hover:text-foreground transition-colors">
                  UNITS / NAV {getSortIcon('units')}
                </button>
              </div>
              <div className="ml-3 w-5"></div>
            </div>
          </div>
          
          <AnimatedList>
            {filteredMetrics.grouped_funds.map((group) => {
              const groupKey = `${group.name}_${group.scheme_code || group.symbol || 'other'}`;
              const isExpanded = expandedFunds.has(groupKey);
              const isFundPositive = group.metrics.absolute_return >= 0;
              
              // Calculate average NAV across all accounts
              const avgNav = group.metrics.current_units > 0 
                ? group.metrics.current_value / group.metrics.current_units 
                : 0;
              
              const typeColors = {
                'mutual_fund': 'bg-blue-500/10 text-blue-600',
                'stock': 'bg-green-500/10 text-green-600',
                'gold': 'bg-yellow-500/10 text-yellow-600',
                'other': 'bg-gray-500/10 text-gray-600'
              };
              
              return (
                <AnimatedListItem key={groupKey}>
                  <Card className="transition-all hover:shadow-md hover:border-primary/40 bg-card/50 backdrop-blur-sm">
                    <CardContent className="p-4">
                      {/* Summary Row - Click anywhere to expand */}
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleFundExpansion(groupKey)}
                      >
                        <div className="flex-1 grid grid-cols-12 gap-2 items-center text-sm">
                          {/* Fund Name & Type */}
                          <div className="col-span-3 flex items-center gap-2">
                            <div className={`p-2 rounded-lg ${typeColors[group.type] || typeColors.other}`}>
                              <Landmark className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{group.name}</div>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${group.type === 'mutual_fund' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : group.type === 'stock' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'}`}>
                                  {group.type === 'mutual_fund' ? 'MF' : group.type === 'stock' ? 'STK' : group.type.toUpperCase()}
                                </span>
                                <span>• {group.accounts.length} acc</span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Value */}
                          <div className="text-right">
                            <div className="font-semibold">{displayValue(group.metrics.current_value)}</div>
                          </div>
                          
                          {/* Invested */}
                          <div className="text-right">
                            <div className="font-medium text-muted-foreground">{displayValue(group.metrics.total_invested)}</div>
                          </div>
                          
                          {/* Returns */}
                          <div className="text-right">
                            <div className={`font-semibold ${isFundPositive ? 'text-green-600' : 'text-red-600'}`}>
                              {displayValue(group.metrics.absolute_return)}
                            </div>
                          </div>
                          
                          {/* Returns % */}
                          <div className="text-right">
                            <div className={`font-bold ${isFundPositive ? 'text-green-600' : 'text-red-600'}`}>
                              {hideValues ? '••' : `${isFundPositive ? '+' : ''}${formatNumber(group.metrics.absolute_return_pct, 2)}%`}
                            </div>
                          </div>
                          
                          {/* XIRR */}
                          <div className="text-right">
                            <div className="font-medium">
                              {hideValues ? '••' : (group.metrics.xirr !== null ? `${formatNumber(group.metrics.xirr, 2)}%` : '-')}
                            </div>
                          </div>
                          
                          {/* Day Change (combined value + %) */}
                          <div className="col-span-2 text-right">
                            {group.metrics.day_change !== null ? (
                              <>
                                <div className={`font-semibold ${group.metrics.day_change >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                                  {hideValues ? '••' : `${group.metrics.day_change >= 0 ? '+' : ''}${formatCurrency(group.metrics.day_change)}`}
                                </div>
                                <div className={`text-xs font-medium ${group.metrics.day_change_pct >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                                  {hideValues ? '••' : `${group.metrics.day_change_pct >= 0 ? '+' : ''}${formatNumber(group.metrics.day_change_pct, 2)}%`}
                                </div>
                              </>
                            ) : (
                              <div className="text-muted-foreground">-</div>
                            )}
                          </div>
                          
                          {/* Units / NAV */}
                          <div className="col-span-2 text-right">
                            <div className="font-medium">{formatNumber(group.metrics.current_units, 2)}</div>
                            <div className="text-xs text-muted-foreground">@ ₹{hideValues ? '••' : formatNumber(avgNav, 2)}</div>
                          </div>
                        </div>
                        <div className="ml-3">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      {/* Expanded Account Details */}
                      {isExpanded && group.accounts.length > 0 && (
                        <div className="mt-4 pt-4 border-t space-y-3">
                          {group.accounts.map(({ fund, metrics }) => {
                            const account = accounts.find(a => a.id === fund.account_id);
                            const isAccountPositive = metrics.absolute_return >= 0;
                            const accountFundKey = `${fund.id}_${fund.account_id}`;
                            const isAccountExpanded = expandedAccountInFund === accountFundKey;
                            
                            // Get transactions for this specific fund
                            const fundTransactions = fund.transactions || [];
                            const sortedTransactions = [...fundTransactions].sort((a, b) => new Date(b.date) - new Date(a.date));
                            
                            return (
                              <div key={fund.id} className="p-4 bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl border border-muted hover:border-primary/30 transition-all">
                                {/* Account Header - Clickable to expand transactions */}
                                <div 
                                  className="flex items-start justify-between mb-4 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isAccountExpanded) {
                                      setExpandedAccountInFund(null);
                                    } else {
                                      setExpandedAccountInFund(accountFundKey);
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-3 flex-1">
                                    <div className="p-2.5 bg-primary/10 rounded-lg">
                                      <Wallet className="h-5 w-5 text-primary" />
                                    </div>
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <h4 className="font-semibold text-base mb-0.5">{account?.name || 'Unknown Account'}</h4>
                                        {isAccountExpanded ? (
                                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="font-medium">{formatNumber(metrics.current_units, 2)} units</span>
                                        {sortedTransactions.length > 0 && (
                                          <span>• {sortedTransactions.length} txn</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Metrics Grid */}
                                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                                  <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Invested</div>
                                    <div className="font-bold text-base">{displayValue(metrics.total_invested)}</div>
                                  </div>
                                  <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Current Value</div>
                                    <div className="font-bold text-base">{displayValue(metrics.current_value)}</div>
                                  </div>
                                  <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Returns</div>
                                    <div className={`font-bold text-base ${isAccountPositive ? 'text-green-600' : 'text-red-600'}`}>
                                      {displayValue(metrics.absolute_return)}
                                    </div>
                                    <div className={`text-xs font-semibold mt-0.5 ${isAccountPositive ? 'text-green-600' : 'text-red-600'}`}>
                                      {hideValues ? '••' : `${isAccountPositive ? '+' : ''}${formatNumber(metrics.absolute_return_pct, 2)}%`}
                                    </div>
                                  </div>
                                  <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                    <div className="text-xs font-medium text-muted-foreground mb-1.5">XIRR</div>
                                    <div className={`font-bold text-base ${metrics.xirr && metrics.xirr >= 0 ? 'text-green-600' : metrics.xirr ? 'text-red-600' : 'text-muted-foreground'}`}>
                                      {metrics.xirr !== null ? (hideValues ? '••' : `${metrics.xirr >= 0 ? '+' : ''}${formatNumber(metrics.xirr, 2)}%`) : 'N/A'}
                                    </div>
                                  </div>
                                  <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Day Change</div>
                                    <div className={`font-bold text-base ${metrics.day_change !== null ? (metrics.day_change >= 0 ? 'text-emerald-600' : 'text-orange-600') : 'text-muted-foreground'}`}>
                                      {metrics.day_change !== null ? (hideValues ? '••' : formatCurrency(metrics.day_change)) : 'N/A'}
                                    </div>
                                    <div className={`text-xs font-semibold mt-0.5 ${metrics.day_change_pct !== null ? (metrics.day_change_pct >= 0 ? 'text-emerald-600' : 'text-orange-600') : 'text-muted-foreground'}`}>
                                      {metrics.day_change_pct !== null ? (hideValues ? '••' : `${metrics.day_change_pct >= 0 ? '+' : ''}${formatNumber(metrics.day_change_pct, 2)}%`) : ''}
                                    </div>
                                  </div>
                                  <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                    <div className="text-xs font-medium text-muted-foreground mb-1.5">Avg NAV</div>
                                    <div className="font-bold text-base">
                                      ₹{metrics.current_units > 0 ? formatNumber(metrics.current_value / metrics.current_units, 2) : '0.00'}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Expanded Transaction Breakdown */}
                                {isAccountExpanded && sortedTransactions.length > 0 && (
                                  <div className="mt-4 pt-4 border-t space-y-3">
                                    <h5 className="text-sm font-semibold mb-2 text-muted-foreground">Transactions</h5>
                                    <div className="space-y-3 max-h-96 overflow-y-auto">
                                      {sortedTransactions.map((txn, idx) => {
                                        // Calculate metrics for this transaction
                                        const currentNav = fund.current_nav || txn.nav;
                                        const currentValue = txn.transaction_type === 'sell' ? 0 : txn.units * currentNav;
                                        const invested = txn.transaction_type === 'sell' ? 0 : txn.amount;
                                        const returns = currentValue - invested;
                                        const returnsPct = invested > 0 ? (returns / invested) * 100 : 0;
                                        const isTxnPositive = returns >= 0;
                                        
                                        // Calculate XIRR for this transaction (days since transaction)
                                        const txnDate = new Date(txn.date);
                                        const today = new Date();
                                        const daysDiff = Math.max(1, Math.floor((today - txnDate) / (1000 * 60 * 60 * 24)));
                                        const txnXirr = (txn.transaction_type === 'sell' || invested === 0) ? null : 
                                          daysDiff > 0 ? (Math.pow(currentValue / invested, 365 / daysDiff) - 1) * 100 : null;
                                        
                                        return (
                                          <div
                                            key={idx}
                                            className="p-3 bg-background/60 rounded-lg border border-muted/50"
                                          >
                                            {/* Transaction Header */}
                                            <div className="flex items-center justify-between mb-3">
                                              <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm">{formatDate(txn.date)}</span>
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
                                            </div>
                                            
                                            {/* Transaction Metrics Grid - Similar to Account Metrics */}
                                            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
                                              <div className="p-2 bg-muted/30 rounded-lg border border-muted/30">
                                                <div className="text-xs font-medium text-muted-foreground mb-1">Invested</div>
                                                <div className="font-bold text-sm">{displayValue(invested)}</div>
                                              </div>
                                              <div className="p-2 bg-muted/30 rounded-lg border border-muted/30">
                                                <div className="text-xs font-medium text-muted-foreground mb-1">Current Value</div>
                                                <div className="font-bold text-sm">{displayValue(currentValue)}</div>
                                              </div>
                                              <div className="p-2 bg-muted/30 rounded-lg border border-muted/30">
                                                <div className="text-xs font-medium text-muted-foreground mb-1">Returns</div>
                                                <div className={`font-bold text-sm ${isTxnPositive ? 'text-green-600' : 'text-red-600'}`}>
                                                  {displayValue(returns)}
                                                </div>
                                                <div className={`text-xs font-semibold mt-0.5 ${isTxnPositive ? 'text-green-600' : 'text-red-600'}`}>
                                                  {hideValues ? '••' : `${isTxnPositive ? '+' : ''}${formatNumber(returnsPct, 2)}%`}
                                                </div>
                                              </div>
                                              <div className="p-2 bg-muted/30 rounded-lg border border-muted/30">
                                                <div className="text-xs font-medium text-muted-foreground mb-1">XIRR</div>
                                                <div className={`font-bold text-sm ${txnXirr && txnXirr >= 0 ? 'text-green-600' : txnXirr ? 'text-red-600' : 'text-muted-foreground'}`}>
                                                  {txnXirr !== null ? (hideValues ? '••' : `${txnXirr >= 0 ? '+' : ''}${formatNumber(txnXirr, 2)}%`) : 'N/A'}
                                                </div>
                                              </div>
                                              <div className="p-2 bg-muted/30 rounded-lg border border-muted/30">
                                                <div className="text-xs font-medium text-muted-foreground mb-1">Units</div>
                                                <div className="font-bold text-sm">{formatNumber(txn.units, 4)}</div>
                                              </div>
                                              <div className="p-2 bg-muted/30 rounded-lg border border-muted/30">
                                                <div className="text-xs font-medium text-muted-foreground mb-1">NAV</div>
                                                <div className="font-bold text-sm">₹{formatNumber(txn.nav, 2)}</div>
                                                {txn.transaction_type !== 'sell' && currentNav !== txn.nav && (
                                                  <div className="text-xs text-muted-foreground mt-0.5">
                                                    Now: ₹{formatNumber(currentNav, 2)}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                
                                {isAccountExpanded && sortedTransactions.length === 0 && (
                                  <div className="mt-4 pt-4 border-t">
                                    <p className="text-xs text-muted-foreground text-center py-2">
                                      No transactions found for this account
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>
        </div>
      )}

      {filteredMetrics && filteredMetrics.fund_metrics.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No investments yet</h3>
            <p className="text-sm text-muted-foreground text-center">
              Start by creating an account and adding your first investment
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

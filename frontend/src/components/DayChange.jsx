import { useState, useEffect, useMemo } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { TrendingUp, TrendingDown, Eye, EyeOff, X } from 'lucide-react';
import { formatCurrency, formatNumber } from '../lib/utils';
import { AnimatedCard } from './ui/AnimatedCard';
import { matchesTypeFilter, isGoldFund } from '../lib/fundUtils';

export function DayChange() {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hideValues, setHideValues] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState([]); // Multi-select: array of account IDs
  const [selectedTypes, setSelectedTypes] = useState([]); // Multi-select: array of types
  const [dayChangeFilter, setDayChangeFilter] = useState('all'); // 'all', 'gainers', 'losers'

  useEffect(() => {
    loadDashboard();
  }, []);

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

  const displayValue = (value) => {
    return hideValues ? '••••••' : formatCurrency(value);
  };

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

  // Filter and calculate metrics based on selections
  const filteredMetrics = useMemo(() => {
    if (!dashboardData) return null;

    let filteredFunds = dashboardData.fund_metrics;

    // Filter out 0-unit funds and EPF
    filteredFunds = filteredFunds.filter(fm => fm.metrics.current_units > 0 && fm.fund.type !== 'epf');

    // Multi-select account filter
    if (selectedAccounts.length > 0) {
      filteredFunds = filteredFunds.filter(fm => selectedAccounts.includes(fm.fund.account_id));
    }

    // Multi-select type filter (supports gold keyword detection)
    if (selectedTypes.length > 0) {
      filteredFunds = filteredFunds.filter(fm => {
        const fund = fm.fund;
        // Check if fund matches any selected type
        return selectedTypes.some(type => matchesTypeFilter(fund, type));
      });
    }

    // Filter by day change
    if (dayChangeFilter === 'gainers') {
      filteredFunds = filteredFunds.filter(fm => fm.metrics.day_change && fm.metrics.day_change > 0);
    } else if (dayChangeFilter === 'losers') {
      filteredFunds = filteredFunds.filter(fm => fm.metrics.day_change && fm.metrics.day_change < 0);
    }

    return filteredFunds;
  }, [dashboardData, selectedAccounts, selectedTypes, dayChangeFilter]);

  // Get unique accounts and types
  const accounts = useMemo(() => {
    if (!dashboardData) return [];
    return dashboardData.account_metrics.map(am => am.account);
  }, [dashboardData]);

  const investmentTypes = useMemo(() => {
    if (!dashboardData) return [];
    const types = new Set();
    dashboardData.fund_metrics.forEach(fm => {
      types.add(fm.fund.type);
      // Add 'gold' type if fund name contains gold keyword
      if (isGoldFund(fm.fund.name) || isGoldFund(fm.fund.symbol) || isGoldFund(fm.fund.scheme_code)) {
        types.add('gold');
      }
    });
    return Array.from(types);
  }, [dashboardData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading day change data...</div>
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

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">Day Change Overview</h2>
            <p className="text-sm text-muted-foreground mt-1">Track daily performance of your investments</p>
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

          {/* Day Change Filter Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filter:</span>
            <button
              onClick={() => setDayChangeFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                dayChangeFilter === 'all'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setDayChangeFilter('gainers')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                dayChangeFilter === 'gainers'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              📈 Gainers
            </button>
            <button
              onClick={() => setDayChangeFilter('losers')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                dayChangeFilter === 'losers'
                  ? 'bg-red-600 text-white shadow-md'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              📉 Losers
            </button>
          </div>
        </div>
      </div>

      {/* Portfolio Day Change Summary */}
      {dashboardData?.portfolio_metrics?.day_change !== undefined && (
        <AnimatedCard delay={0} className={`border-0 bg-gradient-to-br ${dashboardData.portfolio_metrics.day_change >= 0 ? 'from-emerald-500/10 to-emerald-600/5' : 'from-red-500/10 to-red-600/5'} hover:shadow-lg transition-all`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-medium text-muted-foreground">Portfolio Day Change</CardTitle>
            <div className={`p-2 ${dashboardData.portfolio_metrics.day_change >= 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'} rounded-lg`}>
              {dashboardData.portfolio_metrics.day_change >= 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-4xl font-bold ${dashboardData.portfolio_metrics.day_change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {hideValues ? '••' : formatCurrency(dashboardData.portfolio_metrics.day_change)}
            </div>
            <p className={`text-sm mt-2 ${dashboardData.portfolio_metrics.day_change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {hideValues ? '••' : `${dashboardData.portfolio_metrics.day_change >= 0 ? '+' : ''}${formatNumber(dashboardData.portfolio_metrics.day_change_pct, 2)}%`} today
            </p>
          </CardContent>
        </AnimatedCard>
      )}

      {/* Day Change Overview */}
      {filteredMetrics && filteredMetrics.some(fm => fm.metrics.day_change !== null) && (
        <div>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Top Gainers */}
            <Card className="border-emerald-200 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-500/10 dark:to-background">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <TrendingUp className="h-5 w-5" />
                  Top Gainers Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {filteredMetrics
                    .filter(fm => fm.metrics.day_change && fm.metrics.day_change > 0)
                    .sort((a, b) => b.metrics.day_change_pct - a.metrics.day_change_pct)
                    .slice(0, 10)
                    .map(({ fund, metrics }) => (
                      <div key={fund.id} className="flex items-center justify-between p-3 bg-emerald-50/50 dark:bg-emerald-500/10 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{fund.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(metrics.current_units, 2)} units
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-600 dark:text-emerald-400">
                            {hideValues ? '••' : `+${formatCurrency(metrics.day_change)}`}
                          </div>
                          <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            {hideValues ? '••' : `+${formatNumber(metrics.day_change_pct, 2)}%`}
                          </div>
                        </div>
                      </div>
                    ))}
                  {filteredMetrics.filter(fm => fm.metrics.day_change && fm.metrics.day_change > 0).length === 0 && (
                    <div className="text-center text-muted-foreground py-4">
                      No gainers today
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Top Losers */}
            <Card className="border-red-200 dark:border-red-900/40 bg-gradient-to-br from-red-50/50 to-background dark:from-red-500/10 dark:to-background">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-red-700 dark:text-red-300">
                  <TrendingDown className="h-5 w-5" />
                  Top Losers Today
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {filteredMetrics
                    .filter(fm => fm.metrics.day_change && fm.metrics.day_change < 0)
                    .sort((a, b) => a.metrics.day_change_pct - b.metrics.day_change_pct)
                    .slice(0, 10)
                    .map(({ fund, metrics }) => (
                      <div key={fund.id} className="flex items-center justify-between p-3 bg-red-50/50 dark:bg-red-500/10 rounded-lg border border-red-100 dark:border-red-900/40">
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{fund.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(metrics.current_units, 2)} units
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-red-600 dark:text-red-400">
                            {hideValues ? '••' : formatCurrency(metrics.day_change)}
                          </div>
                          <div className="text-xs font-semibold text-red-600 dark:text-red-400">
                            {hideValues ? '••' : `${formatNumber(metrics.day_change_pct, 2)}%`}
                          </div>
                        </div>
                      </div>
                    ))}
                  {filteredMetrics.filter(fm => fm.metrics.day_change && fm.metrics.day_change < 0).length === 0 && (
                    <div className="text-center text-muted-foreground py-4">
                      No losers today
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Day Change Summary Stats */}
          <div className="grid gap-4 md:grid-cols-4 mt-4">
            <Card className="bg-gradient-to-br from-emerald-50/30 to-background dark:from-emerald-500/10 dark:to-background">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground mb-1">Gainers</div>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {filteredMetrics.filter(fm => fm.metrics.day_change && fm.metrics.day_change > 0).length}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-red-50/30 to-background dark:from-red-500/10 dark:to-background">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground mb-1">Losers</div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {filteredMetrics.filter(fm => fm.metrics.day_change && fm.metrics.day_change < 0).length}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-blue-50/30 to-background dark:from-blue-500/10 dark:to-background">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground mb-1">Unchanged</div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {filteredMetrics.filter(fm => fm.metrics.day_change === 0).length}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-gray-50/30 to-background dark:from-gray-500/10 dark:to-background">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground mb-1">No Data</div>
                <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                  {filteredMetrics.filter(fm => fm.metrics.day_change === null).length}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {(!filteredMetrics || filteredMetrics.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No day change data</h3>
            <p className="text-sm text-muted-foreground text-center">
              Update NAV for your investments to see day change information
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

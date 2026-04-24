import { useState, useEffect, useMemo } from 'react';
import { portfolioApi } from '../lib/api';
import { AnimatedCard, AnimatedList, AnimatedListItem } from './ui/AnimatedCard';
import { Card, CardContent } from './ui/Card';
import { formatCurrency, formatDate, formatNumber } from '../lib/utils';
import { TrendingUp, TrendingDown, DollarSign, Target, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, Eye, EyeOff, Wallet, X } from 'lucide-react';
import { matchesTypeFilter, isGoldFund } from '../lib/fundUtils';

export function RealizedGains() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedFunds, setExpandedFunds] = useState(new Set());
  const [expandedAccountInFund, setExpandedAccountInFund] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]); // Multi-select: array of account IDs
  const [selectedTypes, setSelectedTypes] = useState([]); // Multi-select: array of types
  const [sortConfig, setSortConfig] = useState({ key: 'total_realized_gain', direction: 'desc' });
  const [hideValues, setHideValues] = useState(false);

  useEffect(() => {
    loadData();
    loadAccounts();
  }, []);

  const loadData = async () => {
    try {
      const response = await portfolioApi.getRealizedGains();
      setData(response.data);
    } catch (error) {
      console.error('Error loading realized gains:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await portfolioApi.getAccounts();
      setAccounts(response.data);
    } catch (error) {
      console.error('Error loading accounts:', error);
    }
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

  const toggleAccountSelection = (accountId) => {
    setSelectedAccounts(prev => {
      if (prev.includes(accountId)) {
        return prev.filter(id => id !== accountId);
      } else {
        return [...prev, accountId];
      }
    });
  };

  const toggleTypeSelection = (type) => {
    setSelectedTypes(prev => {
      if (prev.includes(type)) {
        return prev.filter(t => t !== type);
      } else {
        return [...prev, type];
      }
    });
  };

  const clearAllFilters = () => {
    setSelectedAccounts([]);
    setSelectedTypes([]);
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

  const displayValue = (value) => {
    return hideValues ? '••••••' : formatCurrency(value);
  };

  const filteredData = useMemo(() => {
    if (!data) return null;

    let filteredFunds = data.funds;

    // Multi-select account filter
    if (selectedAccounts.length > 0) {
      filteredFunds = filteredFunds.filter(f => selectedAccounts.includes(f.account_id));
    }

    // Multi-select type filter (using matchesTypeFilter for gold detection)
    if (selectedTypes.length > 0) {
      filteredFunds = filteredFunds.filter(f => {
        const fundObj = { name: f.fund_name, type: f.fund_type, symbol: f.symbol, scheme_code: f.scheme_code };
        return selectedTypes.some(type => matchesTypeFilter(fundObj, type));
      });
    }

    // Apply sorting
    if (sortConfig.key) {
      filteredFunds = [...filteredFunds].sort((a, b) => {
        let aVal, bVal;
        
        switch(sortConfig.key) {
          case 'fund_name':
            aVal = a.fund_name.toLowerCase();
            bVal = b.fund_name.toLowerCase();
            break;
          case 'total_realized_gain':
            aVal = a.total_realized_gain;
            bVal = b.total_realized_gain;
            break;
          case 'total_sold_amount':
            aVal = a.total_sold_amount;
            bVal = b.total_sold_amount;
            break;
          case 'total_cost_basis':
            aVal = a.total_cost_basis;
            bVal = b.total_cost_basis;
            break;
          case 'gain_pct':
            aVal = a.gain_pct;
            bVal = b.gain_pct;
            break;
          case 'transactions':
            aVal = a.transactions.length;
            bVal = b.transactions.length;
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

    // Group funds by name and scheme_code/symbol (similar to Dashboard)
    const groupedFunds = filteredFunds.reduce((acc, f) => {
      const key = `${f.fund_name}_${f.scheme_code || f.symbol || 'other'}`;
      if (!acc[key]) {
        acc[key] = {
          fund_name: f.fund_name,
          fund_type: f.fund_type,
          scheme_code: f.scheme_code,
          symbol: f.symbol,
          accounts: []
        };
      }
      acc[key].accounts.push(f);
      return acc;
    }, {});

    const groupedFundsArray = Object.values(groupedFunds).map(group => {
      // Calculate group totals
      const groupMetrics = group.accounts.reduce((sum, f) => ({
        total_realized_gain: sum.total_realized_gain + f.total_realized_gain,
        total_sold_amount: sum.total_sold_amount + f.total_sold_amount,
        total_cost_basis: sum.total_cost_basis + f.total_cost_basis,
        transaction_count: sum.transaction_count + f.transactions.length
      }), { total_realized_gain: 0, total_sold_amount: 0, total_cost_basis: 0, transaction_count: 0 });

      const gain_pct = groupMetrics.total_cost_basis > 0 
        ? (groupMetrics.total_realized_gain / groupMetrics.total_cost_basis * 100)
        : 0;

      return {
        ...group,
        fund_id: `${group.fund_name}_${group.scheme_code || group.symbol || 'other'}`,
        total_realized_gain: groupMetrics.total_realized_gain,
        total_sold_amount: groupMetrics.total_sold_amount,
        total_cost_basis: groupMetrics.total_cost_basis,
        gain_pct: gain_pct,
        transactions: group.accounts.flatMap(f => f.transactions)
      };
    });

    // Apply sorting to grouped funds
    if (sortConfig.key) {
      groupedFundsArray.sort((a, b) => {
        let aVal, bVal;
        
        switch(sortConfig.key) {
          case 'fund_name':
            aVal = a.fund_name.toLowerCase();
            bVal = b.fund_name.toLowerCase();
            break;
          case 'total_realized_gain':
            aVal = a.total_realized_gain;
            bVal = b.total_realized_gain;
            break;
          case 'total_sold_amount':
            aVal = a.total_sold_amount;
            bVal = b.total_sold_amount;
            break;
          case 'total_cost_basis':
            aVal = a.total_cost_basis;
            bVal = b.total_cost_basis;
            break;
          case 'gain_pct':
            aVal = a.gain_pct;
            bVal = b.gain_pct;
            break;
          case 'transactions':
            aVal = a.transactions.length;
            bVal = b.transactions.length;
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

    // Recalculate summary from grouped funds
    const totalGain = groupedFundsArray.reduce((sum, f) => sum + f.total_realized_gain, 0);
    const totalSold = groupedFundsArray.reduce((sum, f) => sum + f.total_sold_amount, 0);
    const totalCost = groupedFundsArray.reduce((sum, f) => sum + f.total_cost_basis, 0);

    return {
      summary: {
        total_realized_gain: totalGain,
        total_sold_amount: totalSold,
        total_cost_basis: totalCost,
        overall_gain_pct: totalCost > 0 ? (totalGain / totalCost * 100) : 0,
        funds_with_sales: groupedFundsArray.length
      },
      funds: groupedFundsArray
    };
  }, [data, selectedAccounts, selectedTypes, sortConfig]);

  const investmentTypes = useMemo(() => {
    if (!data) return [];
    const types = new Set();
    
    // Check all funds for gold detection
    const goldFunds = data.funds.filter(f => {
      return isGoldFund(f.fund_name) || isGoldFund(f.symbol) || isGoldFund(f.scheme_code);
    });
    
    // Add all original types
    data.funds.forEach(f => {
      types.add(f.fund_type);
    });
    
    // Add 'gold' type if any gold funds exist
    if (goldFunds.length > 0) {
      types.add('gold');
    }
    
    return Array.from(types).sort();
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading realized gains...</div>
      </div>
    );
  }

  if (!data || data.summary.funds_with_sales === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
            Realized Gains
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Track profits from sold investments</p>
        </div>
        <AnimatedCard className="border-2">
          <div className="flex flex-col items-center justify-center py-12">
            <DollarSign className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Realized Gains Yet</h3>
            <p className="text-sm text-muted-foreground text-center">
              Sell some investments to see your realized profits/losses here
            </p>
          </div>
        </AnimatedCard>
      </div>
    );
  }

  const displayData = filteredData || data;
  const { summary, funds } = displayData;

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
              Realized Gains
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Profits/losses from sold investments</p>
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
                onClick={clearAllFilters}
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
                  onClick={() => toggleAccountSelection(account.id)}
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
                  onClick={() => toggleTypeSelection(type)}
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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AnimatedCard className="border-2 hover:shadow-lg transition-shadow">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">Total Realized Gain</span>
              {summary.total_realized_gain >= 0 ? (
                <TrendingUp className="h-5 w-5 text-green-600" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-600" />
              )}
            </div>
            <div className={`text-3xl font-bold mb-2 ${summary.total_realized_gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(summary.total_realized_gain)}
            </div>
            <p className="text-sm text-muted-foreground">
              {summary.overall_gain_pct >= 0 ? '+' : ''}{summary.overall_gain_pct.toFixed(2)}% overall
            </p>
          </div>
        </AnimatedCard>

        <AnimatedCard className="border-2 hover:shadow-lg transition-shadow">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">Total Sold Amount</span>
              <DollarSign className="h-5 w-5 text-blue-600" />
            </div>
            <div className="text-3xl font-bold mb-2">{formatCurrency(summary.total_sold_amount)}</div>
            <p className="text-sm text-muted-foreground">
              Sale proceeds received
            </p>
          </div>
        </AnimatedCard>

        <AnimatedCard className="border-2 hover:shadow-lg transition-shadow">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">Cost Basis</span>
              <Target className="h-5 w-5 text-purple-600" />
            </div>
            <div className="text-3xl font-bold mb-2">{formatCurrency(summary.total_cost_basis)}</div>
            <p className="text-sm text-muted-foreground">
              Original investment cost
            </p>
          </div>
        </AnimatedCard>

        <AnimatedCard className="border-2 hover:shadow-lg transition-shadow">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">Funds Sold</span>
              <TrendingUp className="h-5 w-5 text-orange-600" />
            </div>
            <div className="text-3xl font-bold mb-2">{summary.funds_with_sales}</div>
            <p className="text-sm text-muted-foreground">
              Investments with sales
            </p>
          </div>
        </AnimatedCard>
      </div>

      {/* Fund-wise Realized Gains */}
      <div>
        <h2 className="text-2xl font-bold mb-4">Fund-wise Realized Gains</h2>
        
        {/* Column Headers */}
        <div className="mb-2 px-5 py-2 bg-muted/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex-1 grid grid-cols-7 gap-3 items-center">
              <button onClick={() => handleSort('fund_name')} className="col-span-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                FUND NAME {getSortIcon('fund_name')}
              </button>
              <button onClick={() => handleSort('total_realized_gain')} className="text-right flex items-center justify-end gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                REALIZED GAIN {getSortIcon('total_realized_gain')}
              </button>
              <button onClick={() => handleSort('gain_pct')} className="text-right flex items-center justify-end gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                GAIN % {getSortIcon('gain_pct')}
              </button>
              <button onClick={() => handleSort('total_sold_amount')} className="text-right flex items-center justify-end gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                SOLD AMOUNT {getSortIcon('total_sold_amount')}
              </button>
              <button onClick={() => handleSort('total_cost_basis')} className="text-right flex items-center justify-end gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                COST BASIS {getSortIcon('total_cost_basis')}
              </button>
              <button onClick={() => handleSort('transactions')} className="text-right flex items-center justify-end gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                TRANSACTIONS {getSortIcon('transactions')}
              </button>
            </div>
            <div className="ml-4 w-5"></div>
          </div>
        </div>
        
        <AnimatedList>
          {funds.map((group) => {
            const isExpanded = expandedFunds.has(group.fund_id);
            const isPositive = group.total_realized_gain >= 0;
            
            return (
              <AnimatedListItem key={group.fund_id}>
                <Card className="transition-all hover:shadow-lg hover:border-primary/50 hover:scale-[1.01] bg-gradient-to-r from-background to-muted/20 cursor-pointer">
                  <CardContent className="p-5">
                    {/* Summary Row */}
                    <div 
                      className="flex items-center justify-between"
                      onClick={() => toggleFundExpansion(group.fund_id)}
                    >
                      <div className="flex-1 grid grid-cols-7 gap-3 items-center">
                        <div className="col-span-2">
                          <div className="font-semibold text-base">{group.fund_name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${group.fund_type === 'mutual_fund' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : group.fund_type === 'stock' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'}`}>
                              {group.fund_type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span>• {group.accounts.length} acc</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {displayValue(group.total_realized_gain)}
                          </div>
                          <div className="text-xs text-muted-foreground">Realized Gain</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            {hideValues ? '••' : `${group.gain_pct >= 0 ? '+' : ''}${formatNumber(group.gain_pct, 2)}%`}
                          </div>
                          <div className="text-xs text-muted-foreground">Gain %</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">{displayValue(group.total_sold_amount)}</div>
                          <div className="text-xs text-muted-foreground">Sold</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">{displayValue(group.total_cost_basis)}</div>
                          <div className="text-xs text-muted-foreground">Cost</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{group.transactions.length}</div>
                          <div className="text-xs text-muted-foreground">Txns</div>
                        </div>
                      </div>
                      <div className="ml-4">
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Account Breakdown */}
                    {isExpanded && group.accounts.length > 0 && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        {group.accounts.map((accountFund) => {
                          const account = accounts.find(a => a.id === accountFund.account_id);
                          const accountFundKey = `${group.fund_id}_${accountFund.account_id}`;
                          const isAccountExpanded = expandedAccountInFund === accountFundKey;
                          const isAccountPositive = accountFund.total_realized_gain >= 0;
                          
                          return (
                            <div key={accountFund.account_id} className="p-4 bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl border border-muted hover:border-primary/30 transition-all">
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
                                      <span>{accountFund.transactions.length} txn</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Account Metrics Grid */}
                              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Realized Gain</div>
                                  <div className={`font-bold text-base ${isAccountPositive ? 'text-green-600' : 'text-red-600'}`}>
                                    {displayValue(accountFund.total_realized_gain)}
                                  </div>
                                  <div className={`text-xs font-semibold mt-0.5 ${isAccountPositive ? 'text-green-600' : 'text-red-600'}`}>
                                    {hideValues ? '••' : `${isAccountPositive ? '+' : ''}${formatNumber(accountFund.gain_pct, 2)}%`}
                                  </div>
                                </div>
                                <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Sold Amount</div>
                                  <div className="font-bold text-base">{displayValue(accountFund.total_sold_amount)}</div>
                                </div>
                                <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Cost Basis</div>
                                  <div className="font-bold text-base">{displayValue(accountFund.total_cost_basis)}</div>
                                </div>
                                <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Transactions</div>
                                  <div className="font-bold text-base">{accountFund.transactions.length}</div>
                                </div>
                              </div>
                              
                              {/* Expanded Transaction Details */}
                              {isAccountExpanded && accountFund.transactions.length > 0 && (
                                <div className="mt-4 pt-4 border-t overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="border-b">
                                        <th className="text-left p-2">Date</th>
                                        <th className="text-right p-2">Units Sold</th>
                                        <th className="text-right p-2">Sell Price</th>
                                        <th className="text-right p-2">Sell Amount</th>
                                        <th className="text-right p-2">Cost Basis</th>
                                        <th className="text-right p-2">Gain/Loss</th>
                                        <th className="text-right p-2">%</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {accountFund.transactions.map((txn, index) => (
                                        <tr key={index} className="border-b hover:bg-muted/50">
                                          <td className="p-2">{formatDate(txn.date)}</td>
                                          <td className="text-right p-2">{txn.units.toFixed(4)}</td>
                                          <td className="text-right p-2">₹{txn.sell_nav.toFixed(2)}</td>
                                          <td className="text-right p-2">{hideValues ? '••••••' : formatCurrency(txn.sell_amount)}</td>
                                          <td className="text-right p-2">{hideValues ? '••••••' : formatCurrency(txn.cost_basis)}</td>
                                          <td className={`text-right p-2 font-semibold ${txn.realized_gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {hideValues ? '••••••' : formatCurrency(txn.realized_gain)}
                                          </td>
                                          <td className={`text-right p-2 ${txn.gain_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {hideValues ? '••' : `${txn.gain_pct >= 0 ? '+' : ''}${txn.gain_pct.toFixed(2)}%`}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
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
    </div>
  );
}

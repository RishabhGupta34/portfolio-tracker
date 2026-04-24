import { useState, useEffect, useRef } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { DateInput } from './ui/DateInput';
import { Modal } from './ui/Modal';
import { toast } from './ui/Toast';
import { Plus, TrendingUp, Trash2, RefreshCw, Search, ChevronDown, ChevronUp, Edit, Calculator, Eye, EyeOff, Copy, Wallet } from 'lucide-react';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';

export function Investments() {
  const [funds, setFunds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedFund, setSelectedFund] = useState(null);
  const [isAddFundModalOpen, setIsAddFundModalOpen] = useState(false);
  const [isAddTransactionModalOpen, setIsAddTransactionModalOpen] = useState(false);
  const [isEditTransactionModalOpen, setIsEditTransactionModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastAddedFundId, setLastAddedFundId] = useState(null);
  const fundRefs = useRef({});
  
  const [fundFormData, setFundFormData] = useState({
    name: '',
    type: 'mutual_fund',
    account_id: '',
    scheme_code: '',
    symbol: '',
  });

  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [updatingNav, setUpdatingNav] = useState(null);
  const [updatingAllNav, setUpdatingAllNav] = useState(false);
  const [calculatingInterest, setCalculatingInterest] = useState(null);
  const [expandedFunds, setExpandedFunds] = useState(new Set());
  const [hideValues, setHideValues] = useState(false);
  const [previewNav, setPreviewNav] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [showExistingFunds, setShowExistingFunds] = useState(false);
  const [isRecordTransactionModalOpen, setIsRecordTransactionModalOpen] = useState(false);
  const [recordTxnStep, setRecordTxnStep] = useState(1); // 1: Select account, 2: Select/Create investment, 3: Add transaction
  const [stockError, setStockError] = useState(null);
  const [recordTxnData, setRecordTxnData] = useState({
    account_id: '',
    fund_id: '',
    is_new_fund: false,
    fund_name: '',
    fund_type: 'mutual_fund',
    scheme_code: '',
    symbol: '',
    date: new Date().toISOString().split('T')[0],
    units: '',
    nav: '',
    transaction_type: 'buy',
  });

  const [transactionFormData, setTransactionFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    units: '',
    nav: '',
    transaction_type: 'buy',
    split_ratio: '',
    notes: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  // Auto-scroll to newly added fund
  useEffect(() => {
    if (lastAddedFundId && fundRefs.current[lastAddedFundId]) {
      setTimeout(() => {
        fundRefs.current[lastAddedFundId]?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
        setLastAddedFundId(null);
      }, 100);
    }
  }, [lastAddedFundId, funds]);

  const loadData = async () => {
    try {
      const [fundsRes, accountsRes] = await Promise.all([
        portfolioApi.getFunds(),
        portfolioApi.getAccounts(),
      ]);
      // Filter out FD and PPF - they're in Deposits tab
      const filteredFunds = fundsRes.data.filter(f => f.type !== 'fd' && f.type !== 'ppf');
      setFunds(filteredFunds);
      setAccounts(accountsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const displayValue = (value, formatter = formatCurrency) => {
    return hideValues ? '••••••' : formatter(value);
  };

  // Filter funds based on search and type
  const filteredFunds = funds.filter(fund => {
    const matchesSearch = fund.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || fund.type === filterType;
    return matchesSearch && matchesType;
  });

  // Group funds by name (and scheme_code/symbol for uniqueness)
  const groupedFunds = filteredFunds.reduce((acc, fund) => {
    const key = `${fund.name}_${fund.scheme_code || fund.symbol || 'other'}`;
    if (!acc[key]) {
      acc[key] = {
        name: fund.name,
        type: fund.type,
        scheme_code: fund.scheme_code,
        symbol: fund.symbol,
        current_nav: fund.current_nav,
        nav_updated_at: fund.nav_updated_at,
        accounts: []
      };
    }
    
    // Calculate metrics for this fund in this account
    let invested = 0;
    let units = 0;
    
    fund.transactions.forEach(txn => {
      if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
        invested += txn.amount;
        units += txn.units;
      } else if (txn.transaction_type === 'sell') {
        if (units > 0) {
          invested -= (txn.units / units) * invested;
        }
        units -= txn.units;
      }
    });
    
    const currentValue = units > 0 && fund.current_nav ? units * fund.current_nav : invested;
    
    acc[key].accounts.push({
      ...fund,
      accountName: accounts.find(a => a.id === fund.account_id)?.name || 'No Account',
      calculated: {
        invested,
        units,
        currentValue,
        returns: currentValue - invested,
        returnsPct: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0
      }
    });
    
    return acc;
  }, {});

  const groupedFundsArray = Object.values(groupedFunds);

  // Calculate totals across all accounts
  const totals = groupedFundsArray.reduce((acc, group) => {
    const groupTotals = group.accounts.reduce((sum, account) => ({
      invested: sum.invested + account.calculated.invested,
      value: sum.value + account.calculated.currentValue
    }), { invested: 0, value: 0 });
    
    return {
      invested: acc.invested + groupTotals.invested,
      value: acc.value + groupTotals.value
    };
  }, { invested: 0, value: 0 });

  const totalReturns = totals.value - totals.invested;
  const totalReturnsPct = totals.invested > 0 ? (totalReturns / totals.invested) * 100 : 0;

  const handleSearchMutualFund = async () => {
    if (!fundFormData.name) return;
    
    setIsSearching(true);
    try {
      const response = await portfolioApi.searchMutualFund(fundFormData.name);
      setSearchResults(response.data.results || []);
    } catch (error) {
      console.error('Error searching mutual fund:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const selectScheme = async (scheme) => {
    // Use exact name from API, not user's search query
    setFundFormData({
      ...fundFormData,
      name: scheme.scheme_name, // This is the exact name from MFAPI
      scheme_code: String(scheme.scheme_code),
    });
    setSearchResults([]);
    
    // Fetch current NAV
    try {
      const navResponse = await portfolioApi.getMutualFundNAV(String(scheme.scheme_code));
      setPreviewNav(navResponse.data);
    } catch (error) {
      console.error('Error fetching NAV preview:', error);
      setPreviewNav(null);
    }
  };

  const selectExistingFund = async (fund) => {
    setFundFormData({
      ...fundFormData,
      name: fund.name,
      type: fund.type,
      scheme_code: fund.scheme_code || '',
      symbol: fund.symbol || '',
    });
    setShowExistingFunds(false);
    
    // Fetch current NAV if available
    if (fund.scheme_code) {
      try {
        const navResponse = await portfolioApi.getMutualFundNAV(String(fund.scheme_code));
        setPreviewNav(navResponse.data);
      } catch (error) {
        console.error('Error fetching NAV preview:', error);
        setPreviewNav(null);
      }
    }
  };

  // Get unique funds (by name and type) for suggestions
  const getUniqueFunds = () => {
    const uniqueMap = new Map();
    funds.forEach(fund => {
      const key = `${fund.name}_${fund.type}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, fund);
      }
    });
    return Array.from(uniqueMap.values());
  };

  const handleRecordTransaction = async (e) => {
    e.preventDefault();
    
    try {
      let fundId = recordTxnData.fund_id;
      
      // Step 1: Create fund if new
      if (recordTxnData.is_new_fund) {
        const fundData = {
          name: recordTxnData.fund_name || recordTxnData.symbol || 'Unnamed Investment',
          type: recordTxnData.fund_type,
          account_id: recordTxnData.account_id,
          scheme_code: recordTxnData.scheme_code || null,
          symbol: recordTxnData.symbol || null,
        };
        
        const fundResponse = await portfolioApi.createFund(fundData);
        fundId = fundResponse.data.id;
        toast.success('Investment created!');
        
        // Auto-fetch NAV for mutual funds and stocks
        if (fundData.scheme_code || fundData.symbol) {
          try {
            await portfolioApi.updateNAV(fundId);
          } catch (navError) {
            console.error('Error auto-fetching NAV:', navError);
          }
        }
      }
      
      // Step 2: Add transaction
      const txnData = {
        fund_id: fundId,
        date: recordTxnData.date,
        units: parseFloat(recordTxnData.units),
        nav: parseFloat(recordTxnData.nav),
        transaction_type: recordTxnData.transaction_type,
      };
      
      await portfolioApi.addTransaction(txnData);
      toast.success('Transaction recorded successfully!');
      
      // Set fund ID for auto-scroll
      setLastAddedFundId(fundId);
      
      // Reset and close
      setIsRecordTransactionModalOpen(false);
      setRecordTxnStep(1);
      setRecordTxnData({
        account_id: '',
        fund_id: '',
        is_new_fund: false,
        fund_name: '',
        fund_type: 'mutual_fund',
        scheme_code: '',
        symbol: '',
        date: new Date().toISOString().split('T')[0],
        units: '',
        nav: '',
        transaction_type: 'buy',
      });
      setSearchResults([]);
      setPreviewNav(null);
      loadData();
    } catch (error) {
      console.error('Error recording transaction:', error);
      toast.error('Failed to record transaction');
    }
  };

  const selectExistingFundForTransaction = async (fund) => {
    setRecordTxnData({
      ...recordTxnData,
      fund_id: fund.id,
      is_new_fund: false,
      fund_name: fund.name,
      fund_type: fund.type,
      scheme_code: fund.scheme_code || '',
      symbol: fund.symbol || '',
    });
    
    // Auto-fetch current NAV/price
    try {
      if (fund.type === 'mutual_fund' && fund.scheme_code) {
        const response = await portfolioApi.getMutualFundNAV(String(fund.scheme_code));
        if (response.data.nav) {
          setRecordTxnData(prev => ({ ...prev, nav: response.data.nav.toString() }));
          toast.success(`Current NAV: ₹${response.data.nav}`);
        }
      } else if (fund.type === 'stock' && fund.symbol) {
        const response = await portfolioApi.getStockPrice(fund.symbol);
        if (response.data.price) {
          setRecordTxnData(prev => ({ ...prev, nav: response.data.price.toString() }));
          toast.success(`Current price: ₹${response.data.price}`);
        }
      }
    } catch (error) {
      console.error('Error fetching current price:', error);
    }
  };

  const selectSchemeForTransaction = async (scheme) => {
    setRecordTxnData({
      ...recordTxnData,
      is_new_fund: true,
      fund_name: scheme.scheme_name,
      fund_type: 'mutual_fund',
      scheme_code: String(scheme.scheme_code),
    });
    setSearchResults([]);
    
    // Fetch NAV
    try {
      const navResponse = await portfolioApi.getMutualFundNAV(String(scheme.scheme_code));
      setPreviewNav(navResponse.data);
      // Auto-fill NAV in transaction
      setRecordTxnData(prev => ({
        ...prev,
        nav: navResponse.data.nav.toString(),
      }));
    } catch (error) {
      console.error('Error fetching NAV:', error);
    }
  };

  const searchMFForTransaction = async () => {
    if (!recordTxnData.fund_name) return;
    
    setIsSearching(true);
    try {
      const response = await portfolioApi.searchMutualFund(recordTxnData.fund_name);
      setSearchResults(response.data.results || []);
    } catch (error) {
      console.error('Error searching:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateFund = async (e) => {
    e.preventDefault();
    try {
      // Convert empty strings to null for optional fields, ensure scheme_code is string
      const fundData = {
        ...fundFormData,
        scheme_code: fundFormData.scheme_code ? String(fundFormData.scheme_code) : null,
        symbol: fundFormData.symbol || null,
      };
      console.log('Creating fund with data:', fundData);
      const response = await portfolioApi.createFund(fundData);
      console.log('Fund created successfully:', response.data);
      
      // Auto-fetch NAV for mutual funds and stocks
      const fundId = response.data.id;
      if (fundData.scheme_code || fundData.symbol) {
        toast.success('Investment created! Fetching latest NAV...');
        try {
          const navResponse = await portfolioApi.updateNAV(fundId);
          if (navResponse.data.current_nav) {
            toast.success(`NAV Updated: ₹${navResponse.data.current_nav}`);
          }
        } catch (navError) {
          console.error('Error auto-fetching NAV:', navError);
          toast.info('Investment created. Click "Update NAV" to fetch latest price.');
        }
      } else {
        toast.success('Investment created successfully!');
      }
      
      setIsAddFundModalOpen(false);
      setFundFormData({ name: '', type: 'mutual_fund', account_id: '', scheme_code: '', symbol: '' });
      setSearchResults([]);
      loadData();
    } catch (error) {
      console.error('Error creating fund:', error);
      console.error('Error response:', error.response);
      const errorMsg = error.response?.data?.detail 
        ? (typeof error.response.data.detail === 'string' 
            ? error.response.data.detail 
            : JSON.stringify(error.response.data.detail))
        : error.message;
      toast.error('Failed to create investment: ' + errorMsg);
    }
  };

  const handleUpdateNAV = async (fundId) => {
    setUpdatingNav(fundId);
    try {
      const response = await portfolioApi.updateNAV(fundId);
      if (response.data.message) {
        toast.success(`NAV Updated! Current NAV: ₹${response.data.current_nav} (${response.data.nav_date})`);
      }
      loadData();
    } catch (error) {
      console.error('Error updating NAV:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error('Failed to update NAV: ' + errorMsg);
    } finally {
      setUpdatingNav(null);
    }
  };

  const handleUpdateAllNAV = async () => {
    setUpdatingAllNav(true);
    const eligibleFunds = funds.filter(f => ['mutual_fund', 'stock'].includes(f.type));
    
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
      loadData();
    } else {
      toast.error('Failed to update NAV for all investments');
    }
    
    setUpdatingAllNav(false);
  };

  const handleCalculateInterest = async (fundId) => {
    setCalculatingInterest(fundId);
    try {
      const response = await portfolioApi.calculateInterest(fundId);
      if (response.data.message) {
        toast.success(`Interest Added: ₹${response.data.interest_amount}`);
      }
      loadData();
    } catch (error) {
      console.error('Error calculating interest:', error);
      const errorMsg = error.response?.data?.detail || error.message;
      toast.error('Failed to calculate interest: ' + errorMsg);
    } finally {
      setCalculatingInterest(null);
    }
  };

  const handleDeleteTransaction = async (fundId, transactionId) => {
    try {
      await portfolioApi.deleteTransaction(fundId, transactionId);
      toast.success('Transaction deleted successfully');
      loadData();
    } catch (error) {
      console.error('Error deleting transaction:', error);
      toast.error('Failed to delete transaction');
    }
  };

  const handleDeleteFund = async (fundId, fundName) => {
    if (!window.confirm(`Are you sure you want to delete "${fundName}"? This will delete all transactions for this investment.`)) {
      return;
    }
    
    try {
      await portfolioApi.deleteFund(fundId);
      toast.success('Investment deleted successfully');
      loadData();
    } catch (error) {
      console.error('Error deleting investment:', error);
      toast.error('Failed to delete investment');
    }
  };

  const openAddTransactionModal = (fund) => {
    setSelectedFund(fund);
    setTransactionFormData({
      date: new Date().toISOString().split('T')[0],
      units: '',
      nav: '',
      transaction_type: 'buy',
      split_ratio: '',
      notes: '',
    });
    setIsAddTransactionModalOpen(true);
  };

  const openEditTransactionModal = (fund, transaction) => {
    setSelectedFund(fund);
    setEditingTransaction(transaction);
    setTransactionFormData({
      date: transaction.date,
      units: transaction.units.toString(),
      nav: transaction.nav.toString(),
      transaction_type: transaction.transaction_type,
    });
    setIsEditTransactionModalOpen(true);
  };

  const openCloneTransactionModal = (fund, transaction) => {
    setSelectedFund(fund);
    setEditingTransaction(null); // Not editing, cloning
    setTransactionFormData({
      date: transaction.date, // Keep same date
      units: transaction.units.toString(),
      nav: transaction.nav.toString(),
      transaction_type: transaction.transaction_type,
    });
    setIsAddTransactionModalOpen(true);
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    
    try {
      const txnData = {
        fund_id: selectedFund.id,
        date: transactionFormData.date,
        units: parseFloat(transactionFormData.units),
        nav: transactionFormData.transaction_type === 'split' ? 0 : parseFloat(transactionFormData.nav),
        transaction_type: transactionFormData.transaction_type,
        split_ratio: transactionFormData.split_ratio || null,
        notes: transactionFormData.notes || null,
      };
      
      await portfolioApi.addTransaction(txnData);
      toast.success('Transaction added successfully!');
      setIsAddTransactionModalOpen(false);
      setTransactionFormData({
        date: new Date().toISOString().split('T')[0],
        units: '',
        nav: '',
        transaction_type: 'buy',
        split_ratio: '',
        notes: '',
      });
      loadData();
    } catch (error) {
      console.error('Error adding transaction:', error);
      toast.error('Failed to add transaction');
    }
  };

  const handleEditTransaction = async (e) => {
    e.preventDefault();
    
    try {
      // Delete old transaction and add new one (simpler than update endpoint)
      await portfolioApi.deleteTransaction(selectedFund.id, editingTransaction.id);
      await portfolioApi.addTransaction({
        fund_id: selectedFund.id,
        date: transactionFormData.date,
        units: parseFloat(transactionFormData.units),
        nav: parseFloat(transactionFormData.nav),
        transaction_type: transactionFormData.transaction_type,
      });
      
      setIsEditTransactionModalOpen(false);
      setEditingTransaction(null);
      setTransactionFormData({
        date: new Date().toISOString().split('T')[0],
        units: '',
        nav: '',
        transaction_type: 'buy',
      });
      loadData();
    } catch (error) {
      console.error('Error editing transaction:', error);
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

  const calculateTransactionMetrics = (transactions) => {
    // Calculate cumulative metrics at each transaction
    return transactions.map((txn, index) => {
      const prevTxns = transactions.slice(0, index + 1);
      let invested = 0;
      let units = 0;
      
      prevTxns.forEach(t => {
        if (t.transaction_type === 'buy') {
          invested += t.amount;
          units += t.units;
        } else {
          if (units > 0) {
            invested -= (t.units / units) * invested;
          }
          units -= t.units;
        }
      });
      
      const currentValue = units * txn.nav;
      const returns = currentValue - invested;
      const returnsPct = invested > 0 ? (returns / invested) * 100 : 0;
      
      return {
        ...txn,
        cumulativeInvested: invested,
        cumulativeUnits: units,
        cumulativeValue: currentValue,
        cumulativeReturns: returns,
        cumulativeReturnsPct: returnsPct,
      };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading investments...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-4 -mx-6 px-6 pt-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="min-w-0">
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent truncate">Investments</h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1 hidden sm:block">Manage your mutual funds and stocks</p>
              </div>
              <button
                onClick={() => setHideValues(!hideValues)}
                className="p-2 rounded-md hover:bg-muted transition-colors flex-shrink-0"
                title={hideValues ? "Show values" : "Hide values"}
              >
                {hideValues ? (
                  <EyeOff className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setIsRecordTransactionModalOpen(true)} className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-xs sm:text-sm flex-1 sm:flex-none">
              <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Record Transaction</span>
              <span className="xs:hidden">Record</span>
            </Button>
            <Button onClick={() => setIsAddFundModalOpen(true)} variant="outline" className="text-xs sm:text-sm flex-1 sm:flex-none">
              <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Add Investment</span>
              <span className="xs:hidden">Add</span>
            </Button>
            <Button 
              onClick={handleUpdateAllNAV} 
              variant="outline" 
              disabled={updatingAllNav}
              className="text-xs sm:text-sm flex-1 sm:flex-none"
            >
              <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 ${updatingAllNav ? 'animate-spin' : ''}`} />
              <span className="hidden xs:inline">Update All NAV</span>
              <span className="xs:hidden">Update All</span>
            </Button>
          </div>
          
          {/* Search and Filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search investments..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-10 rounded-lg border-2 border-input bg-background px-4 py-2 text-sm font-medium hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">📊 All Types</option>
              <option value="mutual_fund">📈 Mutual Funds</option>
              <option value="stock">💹 Stocks</option>
              <option value="gold">🪙 Gold/Silver</option>
              <option value="other">📦 Other</option>
            </select>
            {(searchQuery || filterType !== 'all') && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery('');
                  setFilterType('all');
                }}
              >
                ✕ Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {accounts.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              Please create an account first before adding investments
            </p>
          </CardContent>
        </Card>
      )}

      {funds.length === 0 && accounts.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No investments yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              Add your first investment to start tracking
            </p>
            <Button onClick={() => setIsAddFundModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Investment
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedFundsArray.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {searchQuery || filterType !== 'all' 
                    ? 'No investments match your search/filter' 
                    : 'No investments yet'}
                </p>
              </CardContent>
            </Card>
          )}
          {groupedFundsArray.map((group) => {
            const groupKey = `${group.name}_${group.scheme_code || group.symbol || 'other'}`;
            const isExpanded = expandedFunds.has(groupKey);
            
            // Calculate group totals
            const groupTotals = group.accounts.reduce((sum, account) => ({
              invested: sum.invested + account.calculated.invested,
              units: sum.units + account.calculated.units,
              currentValue: sum.currentValue + account.calculated.currentValue,
              returns: sum.returns + account.calculated.returns
            }), { invested: 0, units: 0, currentValue: 0, returns: 0 });
            
            const groupReturnsPct = groupTotals.invested > 0 ? (groupTotals.returns / groupTotals.invested) * 100 : 0;
            
            return (
              <Card 
                key={groupKey}
                ref={(el) => fundRefs.current[groupKey] = el}
                className="hover:shadow-md transition-shadow"
              >
                <CardContent className="p-4">
                  {/* Clickable Header */}
                  <div 
                    className="flex items-center justify-between gap-3 mb-3 cursor-pointer"
                    onClick={() => toggleFundExpansion(groupKey)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-base truncate">{group.name}</h3>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{group.accounts.length} account{group.accounts.length > 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>{group.type.replace('_', ' ')}</span>
                        {group.current_nav && (
                          <>
                            <span>•</span>
                            <span className="text-green-600 font-medium">₹{group.current_nav}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        <span className="font-medium">{displayValue(groupTotals.invested)} invested</span>
                        <span className="font-medium">{displayValue(groupTotals.currentValue)} current</span>
                        <span className={`font-bold ${groupTotals.returns >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {hideValues ? '••' : `${groupTotals.returns >= 0 ? '+' : ''}${formatCurrency(groupTotals.returns)} (${groupReturnsPct >= 0 ? '+' : ''}${formatNumber(groupReturnsPct, 2)}%)`}
                        </span>
                      </div>
                    </div>
                    
                    {/* Compact Actions */}
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {['mutual_fund', 'stock'].includes(group.type) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={async () => {
                            // Update NAV for all accounts of this fund
                            for (const account of group.accounts) {
                              await handleUpdateNAV(account.id);
                            }
                          }}
                          disabled={group.accounts.some(a => updatingNav === a.id)}
                          title="Update NAV"
                          className="h-8 w-8"
                        >
                          <RefreshCw className={`h-4 w-4 ${group.accounts.some(a => updatingNav === a.id) ? 'animate-spin' : ''}`} />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {/* Expanded Account Details */}
                  {isExpanded && (
                    <div className="space-y-3 pt-3 border-t">
                      {group.accounts.map((account) => {
                        const xirr = account.xirr || null;
                        
                        return (
                          <div key={account.id} className="p-4 bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl border border-muted hover:border-primary/30 transition-all">
                            {/* Account Header */}
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-3 flex-1">
                                <div className="p-2.5 bg-primary/10 rounded-lg">
                                  <Wallet className="h-5 w-5 text-primary" />
                                </div>
                                <div className="flex-1">
                                  <h4 className="font-semibold text-base mb-0.5">{account.accountName}</h4>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-medium">
                                      {account.calculated.units > 0 ? `${formatNumber(account.calculated.units, 4)} units` : 'No units'}
                                    </span>
                                    {group.current_nav && (
                                      <>
                                        <span>•</span>
                                        <span>NAV: ₹{formatNumber(group.current_nav, 2)}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-1.5">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openAddTransactionModal(account)}
                                  title="Add Transaction"
                                  className="h-8 w-8 text-green-600 hover:bg-green-100"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleDeleteFund(account.id, account.name)}
                                  title="Delete"
                                  className="h-8 w-8 text-red-600 hover:bg-red-100"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            
                            {/* Metrics Grid */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                              <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                <div className="text-xs font-medium text-muted-foreground mb-1.5">Invested</div>
                                <div className="font-bold text-base">{displayValue(account.calculated.invested)}</div>
                              </div>
                              <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                <div className="text-xs font-medium text-muted-foreground mb-1.5">Current Value</div>
                                <div className="font-bold text-base">{displayValue(account.calculated.currentValue)}</div>
                              </div>
                              <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                <div className="text-xs font-medium text-muted-foreground mb-1.5">Returns</div>
                                <div className={`font-bold text-base ${account.calculated.returns >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {hideValues ? '••••••' : `${account.calculated.returns >= 0 ? '+' : ''}${formatCurrency(account.calculated.returns)}`}
                                </div>
                                <div className={`text-xs font-semibold mt-0.5 ${account.calculated.returns >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {hideValues ? '••' : `${account.calculated.returnsPct >= 0 ? '+' : ''}${formatNumber(account.calculated.returnsPct, 2)}%`}
                                </div>
                              </div>
                              <div className="p-3 bg-background/60 rounded-lg border border-muted/50">
                                <div className="text-xs font-medium text-muted-foreground mb-1.5">XIRR</div>
                                <div className={`font-bold text-base ${xirr && xirr >= 0 ? 'text-green-600' : xirr ? 'text-red-600' : 'text-muted-foreground'}`}>
                                  {xirr !== null ? (hideValues ? '••' : `${xirr >= 0 ? '+' : ''}${formatNumber(xirr, 2)}%`) : 'N/A'}
                                </div>
                              </div>
                            </div>
                            
                            {account.transactions.length > 0 && (
                              <div className="space-y-1">
                                {account.transactions.map((txn) => (
                                  <div key={txn.id} className="flex items-center justify-between p-2 rounded hover:bg-background/70 text-xs">
                                    <div className="flex items-center gap-3 flex-1">
                                      <span className="text-muted-foreground whitespace-nowrap">{formatDate(txn.date)}</span>
                                      <span className={`px-2 py-0.5 rounded font-medium ${
                                        txn.transaction_type === 'buy' 
                                          ? 'bg-green-100 text-green-800' 
                                          : 'bg-red-100 text-red-800'
                                      }`}>
                                        {txn.transaction_type.toUpperCase()}
                                      </span>
                                      <span className="font-medium">{hideValues ? '••••' : formatNumber(txn.units, 4)} units</span>
                                      <span className="text-muted-foreground">@ ₹{hideValues ? '••' : formatNumber(txn.nav, 2)}</span>
                                      <span className="font-semibold">{displayValue(txn.amount)}</span>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => openCloneTransactionModal(account, txn)}
                                        className="h-6 w-6"
                                        title="Clone"
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => openEditTransactionModal(account, txn)}
                                        className="h-6 w-6"
                                        title="Edit"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleDeleteTransaction(account.id, txn.id)}
                                        className="h-6 w-6 text-red-600"
                                        title="Delete"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Fund Modal */}
      <Modal
        isOpen={isAddFundModalOpen}
        onClose={() => {
          setIsAddFundModalOpen(false);
          setSearchResults([]);
          setPreviewNav(null);
        }}
        title="Add New Investment"
      >
        <form onSubmit={handleCreateFund} className="space-y-4">
          {/* Existing Funds Suggestions */}
          {getUniqueFunds().length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-800">💡 Quick Add from Existing</span>
                <button
                  type="button"
                  onClick={() => setShowExistingFunds(!showExistingFunds)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {showExistingFunds ? 'Hide' : 'Show'}
                </button>
              </div>
              {showExistingFunds && (
                <div className="max-h-32 overflow-y-auto space-y-1 mt-2">
                  {getUniqueFunds().map((fund) => (
                    <button
                      key={fund.id}
                      type="button"
                      onClick={() => selectExistingFund(fund)}
                      className="w-full text-left p-2 hover:bg-blue-100 rounded text-sm flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-blue-900">{fund.name}</div>
                        <div className="text-xs text-blue-600">{fund.type.replace('_', ' ').toUpperCase()}</div>
                      </div>
                      <span className="text-xs text-blue-600">→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Type</label>
            <select
              value={fundFormData.type}
              onChange={(e) => setFundFormData({ ...fundFormData, type: e.target.value, scheme_code: '', symbol: '' })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="mutual_fund">Mutual Fund</option>
              <option value="stock">Stock</option>
              <option value="fd">Fixed Deposit (FD)</option>
              <option value="ppf">Public Provident Fund (PPF)</option>
              <option value="gold">Gold/Silver</option>
              <option value="other">Other</option>
            </select>
          </div>

          {fundFormData.type === 'mutual_fund' ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">Search Mutual Fund</label>
                <div className="flex gap-2">
                  <Input
                    value={fundFormData.name}
                    onChange={(e) => setFundFormData({ ...fundFormData, name: e.target.value })}
                    placeholder="e.g., HDFC Top 100"
                  />
                  <Button
                    type="button"
                    onClick={handleSearchMutualFund}
                    disabled={isSearching || !fundFormData.name}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto border rounded-md">
                  {searchResults.map((scheme, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => selectScheme(scheme)}
                      className="w-full text-left p-3 hover:bg-muted border-b last:border-b-0 text-sm"
                    >
                      <div className="font-medium">{scheme.scheme_name}</div>
                      <div className="text-xs text-muted-foreground">Code: {scheme.scheme_code}</div>
                    </button>
                  ))}
                </div>
              )}

              {fundFormData.scheme_code && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                  <div className="font-medium text-green-800 mb-2">✓ Scheme Selected</div>
                  <div className="text-sm text-green-700">Code: {fundFormData.scheme_code}</div>
                  {previewNav && (
                    <div className="mt-3 pt-3 border-t border-green-200">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-green-800">Current NAV:</span>
                        <span className="text-lg font-bold text-green-900">₹{previewNav.nav}</span>
                      </div>
                      <div className="text-xs text-green-600 mt-1">
                        As of {previewNav.date}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : fundFormData.type === 'stock' ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">Stock Name</label>
                <Input
                  value={fundFormData.name}
                  onChange={(e) => setFundFormData({ ...fundFormData, name: e.target.value })}
                  placeholder="e.g., Reliance Industries"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Stock Symbol (Optional)</label>
                <Input
                  value={fundFormData.symbol}
                  onChange={(e) => setFundFormData({ ...fundFormData, symbol: e.target.value })}
                  placeholder="e.g., RELIANCE (for NSE)"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Symbol for auto NAV updates. Will try NSE (.NS) and BSE (.BO)
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">Investment Name</label>
                <Input
                  value={fundFormData.name}
                  onChange={(e) => setFundFormData({ ...fundFormData, name: e.target.value })}
                  placeholder={`e.g., ${fundFormData.type === 'fd' ? 'SBI FD 2024' : fundFormData.type === 'ppf' ? 'PPF Account' : fundFormData.type === 'gold' ? 'Gold Investment' : 'Investment Name'}`}
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">Account</label>
            <select
              value={fundFormData.account_id}
              onChange={(e) => setFundFormData({ ...fundFormData, account_id: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="">Select an account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Each investment belongs to one account
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setIsAddFundModalOpen(false);
              setSearchResults([]);
            }}>
              Cancel
            </Button>
            <Button type="submit">Add Investment</Button>
          </div>
        </form>
      </Modal>

      {/* Add Transaction Modal */}
      <Modal
        isOpen={isAddTransactionModalOpen}
        onClose={() => setIsAddTransactionModalOpen(false)}
        title={`Add Transaction - ${selectedFund?.name}`}
      >
        <form onSubmit={handleAddTransaction} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Date</label>
            <DateInput
              value={transactionFormData.date}
              onChange={(e) => setTransactionFormData({ ...transactionFormData, date: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Transaction Type</label>
            <select
              value={transactionFormData.transaction_type}
              onChange={(e) => setTransactionFormData({ ...transactionFormData, transaction_type: e.target.value, nav: e.target.value === 'bonus' ? '0' : transactionFormData.nav })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              {selectedFund?.type === 'stock' && (
                <>
                  <option value="bonus">Bonus Shares</option>
                  <option value="split">Stock Split</option>
                </>
              )}
            </select>
            {transactionFormData.transaction_type === 'bonus' && (
              <p className="text-xs text-green-600 mt-1">
                💡 Bonus shares received at no cost (NAV = 0)
              </p>
            )}
            {transactionFormData.transaction_type === 'split' && (
              <p className="text-xs text-blue-600 mt-1">
                💡 Stock split will adjust all previous transactions
              </p>
            )}
          </div>
          
          {transactionFormData.transaction_type === 'split' && (
            <div>
              <label className="block text-sm font-medium mb-2">Split Ratio *</label>
              <Input
                value={transactionFormData.split_ratio}
                onChange={(e) => {
                  const ratio = e.target.value;
                  setTransactionFormData({ ...transactionFormData, split_ratio: ratio });
                  
                  // Auto-calculate units after split
                  if (ratio && selectedFund) {
                    try {
                      const [oldShares, newShares] = ratio.split(':').map(n => parseInt(n.trim()));
                      if (oldShares && newShares) {
                        const multiplier = newShares / oldShares;
                        // Calculate current holdings before split
                        let currentUnits = 0;
                        selectedFund.transactions.forEach(txn => {
                          if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
                            currentUnits += txn.units;
                          } else if (txn.transaction_type === 'sell') {
                            currentUnits -= txn.units;
                          }
                        });
                        const unitsAfterSplit = currentUnits * multiplier;
                        setTransactionFormData(prev => ({ ...prev, units: unitsAfterSplit.toString() }));
                      }
                    } catch (e) {
                      console.error('Error calculating split units:', e);
                    }
                  }
                }}
                placeholder="e.g., 1:2 (1 share becomes 2)"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Format: old:new (e.g., 1:2, 1:5, 2:3). Units will be auto-calculated.
              </p>
            </div>
          )}
          
          {transactionFormData.transaction_type !== 'split' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                {transactionFormData.transaction_type === 'bonus' ? 'Bonus Shares Received' : 'Units'}
              </label>
              <Input
                type="number"
                step="0.0001"
                value={transactionFormData.units}
                onChange={(e) => setTransactionFormData({ ...transactionFormData, units: e.target.value })}
                placeholder="e.g., 10.5"
                required
              />
            </div>
          )}
          
          {transactionFormData.transaction_type === 'split' && (
            <div>
              <label className="block text-sm font-medium mb-2">Total Units After Split</label>
              <Input
                type="number"
                step="0.0001"
                value={transactionFormData.units}
                onChange={(e) => setTransactionFormData({ ...transactionFormData, units: e.target.value })}
                placeholder="Auto-calculated"
                required
              />
              <p className="text-xs text-green-600 mt-1">
                ✓ Auto-calculated based on split ratio. You can adjust if needed.
              </p>
            </div>
          )}
          
          {transactionFormData.transaction_type !== 'split' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                {transactionFormData.transaction_type === 'bonus' ? 'NAV (will be 0)' : 'NAV / Price'}
              </label>
              <Input
                type="number"
                step="0.01"
                value={transactionFormData.nav}
                onChange={(e) => setTransactionFormData({ ...transactionFormData, nav: e.target.value })}
                placeholder="e.g., 150.50"
                required
                disabled={transactionFormData.transaction_type === 'bonus'}
              />
            </div>
          )}
          
          {transactionFormData.notes !== undefined && (
            <div>
              <label className="block text-sm font-medium mb-2">Notes (Optional)</label>
              <Input
                value={transactionFormData.notes}
                onChange={(e) => setTransactionFormData({ ...transactionFormData, notes: e.target.value })}
                placeholder="Add any notes..."
              />
            </div>
          )}
          
          {transactionFormData.units && transactionFormData.nav && transactionFormData.transaction_type !== 'bonus' && transactionFormData.transaction_type !== 'split' && (
            <div className="p-3 bg-muted rounded-md">
              <div className="text-sm text-muted-foreground">Total Amount</div>
              <div className="text-lg font-bold">
                {formatCurrency(parseFloat(transactionFormData.units) * parseFloat(transactionFormData.nav))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsAddTransactionModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Transaction</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Transaction Modal */}
      <Modal
        isOpen={isEditTransactionModalOpen}
        onClose={() => {
          setIsEditTransactionModalOpen(false);
          setEditingTransaction(null);
        }}
        title={`Edit Transaction - ${selectedFund?.name}`}
      >
        <form onSubmit={handleEditTransaction} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Date</label>
            <DateInput
              value={transactionFormData.date}
              onChange={(e) => setTransactionFormData({ ...transactionFormData, date: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Transaction Type</label>
            <select
              value={transactionFormData.transaction_type}
              onChange={(e) => setTransactionFormData({ ...transactionFormData, transaction_type: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Units</label>
            <Input
              type="number"
              step="0.0001"
              value={transactionFormData.units}
              onChange={(e) => setTransactionFormData({ ...transactionFormData, units: e.target.value })}
              placeholder="e.g., 10.5"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">NAV / Price</label>
            <Input
              type="number"
              step="0.01"
              value={transactionFormData.nav}
              onChange={(e) => setTransactionFormData({ ...transactionFormData, nav: e.target.value })}
              placeholder="e.g., 150.50"
              required
            />
          </div>
          {transactionFormData.units && transactionFormData.nav && (
            <div className="p-3 bg-muted rounded-md">
              <div className="text-sm text-muted-foreground">Total Amount</div>
              <div className="text-lg font-bold">
                {formatCurrency(parseFloat(transactionFormData.units) * parseFloat(transactionFormData.nav))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setIsEditTransactionModalOpen(false);
              setEditingTransaction(null);
            }}>
              Cancel
            </Button>
            <Button type="submit">Save Changes</Button>
          </div>
        </form>
      </Modal>

      {/* Record Transaction Modal - Unified Flow */}
      <Modal
        isOpen={isRecordTransactionModalOpen}
        onClose={() => {
          setIsRecordTransactionModalOpen(false);
          setRecordTxnStep(1);
          setSearchResults([]);
          setPreviewNav(null);
        }}
        title="Record Transaction"
      >
        <form onSubmit={handleRecordTransaction} className="space-y-4">
          {/* Step 1: Select Account */}
          <div>
            <label className="block text-sm font-medium mb-2">Account *</label>
            <select
              value={recordTxnData.account_id}
              onChange={(e) => setRecordTxnData({ ...recordTxnData, account_id: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Select Investment Type */}
          {recordTxnData.account_id && (
            <>
              <div className="border-t pt-4">
                <label className="block text-sm font-medium mb-2">Investment Type *</label>
                <select
                  value={recordTxnData.fund_type}
                  onChange={(e) => {
                    setRecordTxnData({ ...recordTxnData, fund_type: e.target.value, is_new_fund: false, fund_id: '', fund_name: '', scheme_code: '', symbol: '' });
                    setStockError(null);
                    setPreviewNav(null);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="mutual_fund">Mutual Fund</option>
                  <option value="stock">Stock</option>
                  <option value="gold">Gold/Silver</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Step 3: Select Existing or Create New */}
              <div className="border-t pt-4 space-y-3">
                {/* Existing investments filtered by type */}
                {funds.filter(f => f.account_id === recordTxnData.account_id && f.type === recordTxnData.fund_type).length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Select Existing {recordTxnData.fund_type.replace('_', ' ').toUpperCase()}:</p>
                    <div className="max-h-32 overflow-y-auto space-y-1 border rounded-md p-2">
                      {funds.filter(f => f.account_id === recordTxnData.account_id && f.type === recordTxnData.fund_type).map((fund) => (
                        <button
                          key={fund.id}
                          type="button"
                          onClick={() => selectExistingFundForTransaction(fund)}
                          className={`w-full text-left p-2 rounded text-sm hover:bg-muted ${recordTxnData.fund_id === fund.id ? 'bg-primary/10 border border-primary' : ''}`}
                        >
                          <div className="font-medium">{fund.name}</div>
                          {fund.symbol && <div className="text-xs text-muted-foreground">Symbol: {fund.symbol}</div>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Or create new */}
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {funds.filter(f => f.account_id === recordTxnData.account_id && f.type === recordTxnData.fund_type).length > 0 
                      ? 'Or Add New:' 
                      : 'Add New Investment:'}
                  </p>

                  {recordTxnData.fund_type === 'mutual_fund' && (
                    <>
                      <div className="flex gap-2">
                        <Input
                          value={recordTxnData.fund_name}
                          onChange={(e) => setRecordTxnData({ ...recordTxnData, fund_name: e.target.value, is_new_fund: true })}
                          placeholder="Search mutual fund..."
                        />
                        <Button
                          type="button"
                          onClick={searchMFForTransaction}
                          disabled={isSearching}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>

                      {searchResults.length > 0 && (
                        <div className="max-h-40 overflow-y-auto border rounded-md">
                          {searchResults.map((scheme, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => selectSchemeForTransaction(scheme)}
                              className="w-full text-left p-2 hover:bg-muted border-b last:border-b-0 text-sm"
                            >
                              <div className="font-medium">{scheme.scheme_name}</div>
                              <div className="text-xs text-muted-foreground">Code: {scheme.scheme_code}</div>
                            </button>
                          ))}
                        </div>
                      )}

                      {recordTxnData.scheme_code && (
                        <div className="p-2 bg-green-50 border border-green-200 rounded text-sm">
                          <div className="font-medium text-green-800">✓ {recordTxnData.fund_name}</div>
                          {previewNav && (
                            <div className="text-xs text-green-600 mt-1">
                              Current NAV: ₹{previewNav.nav} ({previewNav.date})
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {recordTxnData.fund_type === 'stock' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-2">Stock Symbol *</label>
                        <Input
                          value={recordTxnData.symbol}
                          onChange={async (e) => {
                            const symbol = e.target.value.toUpperCase();
                            setRecordTxnData(prev => ({ ...prev, symbol, is_new_fund: true }));
                            setStockError(null);
                            
                            // Auto-fetch price when symbol is entered
                            if (symbol.length >= 2) {
                              try {
                                const response = await portfolioApi.getStockPrice(symbol);
                                if (response.data.price) {
                                  const stockName = response.data.name || symbol;
                                  // Update both symbol and name
                                  setRecordTxnData(prev => ({ 
                                    ...prev,
                                    symbol: symbol,
                                    nav: response.data.price.toString(),
                                    fund_name: stockName
                                  }));
                                  setPreviewNav({ 
                                    nav: response.data.price, 
                                    date: new Date().toLocaleDateString(),
                                    name: stockName
                                  });
                                  setStockError(null);
                                } else {
                                  setStockError(`Symbol "${symbol}" not found`);
                                  setPreviewNav(null);
                                }
                              } catch (error) {
                                console.error('Stock fetch error:', error);
                                if (symbol.length >= 2) {
                                  setStockError(`Symbol "${symbol}" not found or invalid`);
                                  setPreviewNav(null);
                                }
                              }
                            } else {
                              setPreviewNav(null);
                              setStockError(null);
                            }
                          }}
                          placeholder="e.g., RELIANCE, TCS, INFY"
                          required
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Enter NSE symbol. Price will be fetched automatically.
                        </p>
                      </div>
                      
                      {stockError && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                          <div className="text-sm text-red-800">❌ {stockError}</div>
                          <div className="text-xs text-red-600 mt-1">
                            Please check the symbol and try again
                          </div>
                        </div>
                      )}
                      
                      {previewNav && recordTxnData.symbol && recordTxnData.nav && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                          <div className="font-medium text-green-800 mb-2">✓ {previewNav.name || recordTxnData.symbol}</div>
                          <div className="text-xs text-green-600 mb-2">Symbol: {recordTxnData.symbol}</div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-green-800">Current Price:</span>
                            <span className="text-lg font-bold text-green-900">₹{previewNav.nav}</span>
                          </div>
                          <div className="text-xs text-green-600 mt-1">
                            As of {previewNav.date}
                          </div>
                        </div>
                      )}
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Stock Name (Optional)</label>
                        <Input
                          value={recordTxnData.fund_name || recordTxnData.symbol || ''}
                          onChange={(e) => setRecordTxnData({ ...recordTxnData, fund_name: e.target.value, is_new_fund: true })}
                          placeholder="Auto-filled with symbol, or enter custom name"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Shows symbol by default. Edit to add a custom name.
                        </p>
                      </div>
                    </>
                  )}

                  {recordTxnData.fund_type !== 'mutual_fund' && recordTxnData.fund_type !== 'stock' && (
                    <Input
                      value={recordTxnData.fund_name}
                      onChange={(e) => setRecordTxnData({ ...recordTxnData, fund_name: e.target.value, is_new_fund: true })}
                      placeholder="Investment name..."
                      required
                    />
                  )}
                </div>
              </div>

              {/* Step 3: Transaction Details */}
              {(recordTxnData.fund_id || (recordTxnData.is_new_fund && (recordTxnData.fund_name || recordTxnData.scheme_code || recordTxnData.symbol))) && (
                <div className="border-t pt-4 space-y-3">
                  <h3 className="font-medium">Transaction Details</h3>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">Date *</label>
                    <DateInput
                      value={recordTxnData.date}
                      onChange={(e) => setRecordTxnData({ ...recordTxnData, date: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Type *</label>
                    <select
                      value={recordTxnData.transaction_type}
                      onChange={(e) => setRecordTxnData({ ...recordTxnData, transaction_type: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Units *</label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={recordTxnData.units}
                      onChange={(e) => setRecordTxnData({ ...recordTxnData, units: e.target.value })}
                      placeholder="e.g., 10.5"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">NAV / Price *</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={recordTxnData.nav}
                      onChange={(e) => setRecordTxnData({ ...recordTxnData, nav: e.target.value })}
                      placeholder="e.g., 150.50"
                      required
                    />
                  </div>

                  {recordTxnData.units && recordTxnData.nav && (
                    <div className="p-3 bg-muted rounded-md">
                      <div className="text-sm text-muted-foreground">Total Amount</div>
                      <div className="text-lg font-bold">
                        {formatCurrency(parseFloat(recordTxnData.units) * parseFloat(recordTxnData.nav))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => {
              setIsRecordTransactionModalOpen(false);
              setRecordTxnStep(1);
            }}>
              Cancel
            </Button>
            <Button 
              type="submit"
              disabled={!recordTxnData.account_id || (!recordTxnData.fund_id && !recordTxnData.fund_name && !recordTxnData.scheme_code && !recordTxnData.symbol) || !recordTxnData.units || !recordTxnData.nav}
            >
              Record Transaction
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

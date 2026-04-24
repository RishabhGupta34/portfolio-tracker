import { useState, useEffect } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { DateInput } from './ui/DateInput';
import { Modal } from './ui/Modal';
import { toast } from './ui/Toast';
import { Skeleton, SkeletonCard } from './ui/Skeleton';
import { AnimatedCard, AnimatedList, AnimatedListItem } from './ui/AnimatedCard';
import { Tooltip } from './ui/Tooltip';
import { Plus, Landmark, Calculator, TrendingUp, Calendar, Edit, Trash2, Filter, PieChart, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/utils';

export function Deposits() {
  const [deposits, setDeposits] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [banks, setBanks] = useState([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAddDepositModalOpen, setIsAddDepositModalOpen] = useState(false);
  const [selectedPPF, setSelectedPPF] = useState(null);
  const [depositType, setDepositType] = useState('fd');
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState('all');
  const [selectedDepositType, setSelectedDepositType] = useState('all');
  const [expandedDeposits, setExpandedDeposits] = useState(new Set());
  
  const [depositFormData, setDepositFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    type: 'deposit', // 'deposit' or 'interest'
  });

  const [fdFormData, setFdFormData] = useState({
    name: '',
    bank: '',
    principal: '',
    interest_rate: '',
    start_date: new Date().toISOString().split('T')[0],
    maturity_date: '',
    account_id: ''
  });

  const [ppfFormData, setPpfFormData] = useState({
    name: '',
    ppf_account_number: '',
    interest_rate: '7.1',
    account_id: '',
    initial_balance: ''
  });

  const [epfFormData, setEpfFormData] = useState({
    name: '',
    epf_account_number: '',
    interest_rate: '8.25',
    account_id: '',
    initial_balance: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [fundsRes, accountsRes, banksRes] = await Promise.all([
        portfolioApi.getFunds(),
        portfolioApi.getAccounts(),
        portfolioApi.getBanks(),
      ]);
      
      // Filter only FD, PPF, and EPF
      const depositFunds = fundsRes.data.filter(f => ['fd', 'ppf', 'epf'].includes(f.type));
      setDeposits(depositFunds);
      setAccounts(accountsRes.data);
      setBanks(banksRes.data.banks || []);
    } catch (error) {
      console.error('Error loading deposits:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFD = async (e) => {
    e.preventDefault();
    try {
      const response = await portfolioApi.createFund({
        ...fdFormData,
        type: 'fd',
        principal: parseFloat(fdFormData.principal),
        interest_rate: parseFloat(fdFormData.interest_rate),
      });
      
      // Auto-calculate maturity value
      try {
        await portfolioApi.calculateFDMaturity(response.data.id);
      } catch (calcError) {
        console.error('Error calculating FD maturity:', calcError);
        // Don't fail the whole operation if calculation fails
      }
      
      setIsAddModalOpen(false);
      setFdFormData({
        name: '',
        bank: '',
        principal: '',
        interest_rate: '',
        start_date: new Date().toISOString().split('T')[0],
        maturity_date: '',
        account_id: ''
      });
      toast.success('FD created successfully!');
      loadData();
    } catch (error) {
      console.error('Error creating FD:', error);
      toast.error('Failed to create FD: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleCreatePPF = async (e) => {
    e.preventDefault();
    try {
      const response = await portfolioApi.createFund({
        ...ppfFormData,
        type: 'ppf',
        name: ppfFormData.name,
        interest_rate: parseFloat(ppfFormData.interest_rate),
      });
      
      // Add initial balance as a transaction if provided
      if (ppfFormData.initial_balance && parseFloat(ppfFormData.initial_balance) > 0) {
        await portfolioApi.addTransaction({
          fund_id: response.data.id,
          date: new Date().toISOString().split('T')[0],
          units: parseFloat(ppfFormData.initial_balance),
          nav: 1.0,
          transaction_type: 'buy',
        });
      }
      
      setIsAddModalOpen(false);
      setPpfFormData({
        name: '',
        ppf_account_number: '',
        interest_rate: '7.1',
        account_id: '',
        initial_balance: ''
      });
      toast.success('PPF created successfully!');
      loadData();
    } catch (error) {
      console.error('Error creating PPF:', error);
      toast.error('Failed to create PPF: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleCreateEPF = async (e) => {
    e.preventDefault();
    try {
      const response = await portfolioApi.createFund({
        ...epfFormData,
        type: 'epf',
        name: epfFormData.name,
        interest_rate: parseFloat(epfFormData.interest_rate),
      });
      
      // Add initial balance as a transaction if provided
      if (epfFormData.initial_balance && parseFloat(epfFormData.initial_balance) > 0) {
        await portfolioApi.addTransaction({
          fund_id: response.data.id,
          date: new Date().toISOString().split('T')[0],
          units: parseFloat(epfFormData.initial_balance),
          nav: 1.0,
          transaction_type: 'buy',
        });
      }
      
      setIsAddModalOpen(false);
      setEpfFormData({
        name: '',
        epf_account_number: '',
        interest_rate: '8.25',
        account_id: '',
        initial_balance: ''
      });
      toast.success('EPF created successfully!');
      loadData();
    } catch (error) {
      console.error('Error creating EPF:', error);
      toast.error('Failed to create EPF: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleCalculateFDMaturity = async (fundId) => {
    try {
      const response = await portfolioApi.calculateFDMaturity(fundId);
      const data = response.data;
      toast.success(`FD Maturity: ₹${data.maturity_value} (Interest: ₹${data.interest_earned})`);
      loadData();
    } catch (error) {
      console.error('Error calculating FD maturity:', error);
      toast.error('Failed to calculate maturity: ' + (error.response?.data?.detail || error.message));
    }
  };

  const toggleDepositExpansion = (depositId) => {
    const newExpanded = new Set(expandedDeposits);
    if (newExpanded.has(depositId)) {
      newExpanded.delete(depositId);
    } else {
      newExpanded.add(depositId);
    }
    setExpandedDeposits(newExpanded);
  };

  const openAddDepositModal = (ppf) => {
    setSelectedPPF(ppf);
    setDepositFormData({
      date: new Date().toISOString().split('T')[0],
      amount: '',
      type: 'deposit',
    });
    setIsAddDepositModalOpen(true);
  };

  const handleAddDeposit = async (e) => {
    e.preventDefault();
    try {
      await portfolioApi.addTransaction({
        fund_id: selectedPPF.id,
        date: depositFormData.date,
        units: parseFloat(depositFormData.amount),
        nav: 1.0,
        transaction_type: 'buy',
      });
      
      setIsAddDepositModalOpen(false);
      setDepositFormData({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        type: 'deposit',
      });
      toast.success('Deposit added successfully!');
      loadData();
    } catch (error) {
      console.error('Error adding deposit:', error);
      toast.error('Failed to add deposit: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleDeleteDeposit = async (depositId, depositName) => {
    if (!window.confirm(`Are you sure you want to delete "${depositName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await portfolioApi.deleteFund(depositId);
      toast.success('Deposit deleted successfully!');
      loadData();
    } catch (error) {
      console.error('Error deleting deposit:', error);
      toast.error('Failed to delete deposit: ' + (error.response?.data?.detail || error.message));
    }
  };

  // Filter deposits
  let filteredDeposits = deposits;
  if (selectedAccount !== 'all') {
    filteredDeposits = filteredDeposits.filter(d => d.account_id === selectedAccount);
  }
  if (selectedDepositType !== 'all') {
    filteredDeposits = filteredDeposits.filter(d => d.type === selectedDepositType);
  }

  // Calculate totals
  const fdDeposits = filteredDeposits.filter(d => d.type === 'fd');
  const ppfDeposits = filteredDeposits.filter(d => d.type === 'ppf');
  const epfDeposits = filteredDeposits.filter(d => d.type === 'epf');
  
  const totalFDPrincipal = fdDeposits.reduce((sum, fd) => sum + (fd.principal || 0), 0);
  const totalFDMaturity = fdDeposits.reduce((sum, fd) => sum + (fd.maturity_value || 0), 0);
  const totalPPFBalance = ppfDeposits.reduce((sum, ppf) => {
    const balance = ppf.transactions.reduce((s, t) => s + (t.transaction_type === 'buy' ? t.amount : -t.amount), 0);
    return sum + balance;
  }, 0);
  const totalEPFBalance = epfDeposits.reduce((sum, epf) => {
    const balance = epf.transactions.reduce((s, t) => s + (t.transaction_type === 'buy' ? t.amount : -t.amount), 0);
    return sum + balance;
  }, 0);
  
  const totalValue = totalFDMaturity + totalPPFBalance + totalEPFBalance;
  const totalDeposited = totalFDPrincipal + totalPPFBalance + totalEPFBalance;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2">
        <div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">Deposits</h2>
          <p className="text-sm text-muted-foreground mt-1">Track your Fixed Deposits and PPF accounts</p>
        </div>
        
        <div className="flex gap-3 items-center flex-wrap">
          <Filter className="h-5 w-5 text-muted-foreground" />
          
          {/* Account Filter */}
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          {/* Type Filter */}
          <select
            value={selectedDepositType}
            onChange={(e) => setSelectedDepositType(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Types</option>
            <option value="fd">Fixed Deposits</option>
            <option value="ppf">PPF</option>
            <option value="epf">EPF</option>
          </select>

          <Tooltip content={accounts.length === 0 ? "Create an account first" : "Add new FD or PPF"}>
            <Button 
              onClick={() => setIsAddModalOpen(true)} 
              disabled={accounts.length === 0}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Deposit
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Active Filters Badge */}
      {(selectedAccount !== 'all' || selectedDepositType !== 'all') && (
        <div className="flex gap-2 items-center text-sm">
          <span className="text-muted-foreground">Filtered by:</span>
          {selectedAccount !== 'all' && (
            <span className="px-3 py-1 bg-primary/10 text-primary rounded-full">
              {accounts.find(a => a.id === selectedAccount)?.name}
            </span>
          )}
          {selectedDepositType !== 'all' && (
            <span className="px-3 py-1 bg-primary/10 text-primary rounded-full">
              {selectedDepositType === 'fd' ? 'Fixed Deposits' : selectedDepositType === 'ppf' ? 'PPF' : 'EPF'}
            </span>
          )}
          <button
            onClick={() => {
              setSelectedAccount('all');
              setSelectedDepositType('all');
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {accounts.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              Please create an account first before adding deposits
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <AnimatedCard delay={0} className="border-0 bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 hover:shadow-lg transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <PieChart className="h-4 w-4 text-indigo-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-600">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {fdDeposits.length + ppfDeposits.length} deposits
            </p>
          </CardContent>
        </AnimatedCard>

        <AnimatedCard delay={0.1} className="border-0 bg-gradient-to-br from-blue-500/10 to-blue-600/5 hover:shadow-lg transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">FD Principal</CardTitle>
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Landmark className="h-4 w-4 text-blue-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{formatCurrency(totalFDPrincipal)}</div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {fdDeposits.length} Fixed Deposits
            </p>
          </CardContent>
        </AnimatedCard>

        <AnimatedCard delay={0.2} className="border-0 bg-gradient-to-br from-green-500/10 to-green-600/5 hover:shadow-lg transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">FD Maturity Value</CardTitle>
              <div className="p-2 bg-green-500/20 rounded-lg">
                <TrendingUp className="h-4 w-4 text-green-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{formatCurrency(totalFDMaturity)}</div>
            <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
              <Calculator className="h-3 w-3" />
              +{formatCurrency(totalFDMaturity - totalFDPrincipal)} interest
            </p>
          </CardContent>
        </AnimatedCard>

        <AnimatedCard delay={0.3} className="border-0 bg-gradient-to-br from-purple-500/10 to-purple-600/5 hover:shadow-lg transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">PPF Balance</CardTitle>
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Landmark className="h-4 w-4 text-purple-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">{formatCurrency(totalPPFBalance)}</div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {ppfDeposits.length} PPF Accounts
            </p>
          </CardContent>
        </AnimatedCard>
      </div>

      {/* All Deposits List */}
      {(fdDeposits.length > 0 || ppfDeposits.length > 0 || epfDeposits.length > 0) && (
        <div>
          <h3 className="text-2xl font-bold mb-4">All Deposits</h3>
          <AnimatedList>
            {[...fdDeposits, ...ppfDeposits, ...epfDeposits].map((deposit) => {
              const account = accounts.find(a => a.id === deposit.account_id);
              const isExpanded = expandedDeposits.has(deposit.id);
              const isFD = deposit.type === 'fd';
              const isPPF = deposit.type === 'ppf';
              const isEPF = deposit.type === 'epf';
              const balance = (!isFD) ? deposit.transactions.reduce(
                (sum, t) => sum + (t.transaction_type === 'buy' ? t.amount : -t.amount), 0
              ) : 0;
              
              return (
                <AnimatedListItem key={deposit.id}>
                  <Card className="transition-all hover:shadow-lg hover:border-primary/50 hover:scale-[1.01] bg-gradient-to-r from-background to-muted/20">
                    <CardContent className="p-5">
                    {/* Summary Row - Click anywhere to expand */}
                    <div 
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => toggleDepositExpansion(deposit.id)}
                    >
                      <div className="flex-1 grid grid-cols-6 gap-4 items-center">
                        <div className="col-span-2 flex items-center gap-3">
                          <div className={`p-3 rounded-xl ${isFD ? 'bg-blue-500/10' : isEPF ? 'bg-green-500/10' : 'bg-purple-500/10'}`}>
                            <Landmark className={`h-5 w-5 ${isFD ? 'text-blue-600' : isEPF ? 'text-green-600' : 'text-purple-600'}`} />
                          </div>
                          <div>
                            <div className="font-semibold text-base flex items-center gap-2">
                              {deposit.name}
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isFD ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : isEPF ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'}`}>
                                {isFD ? deposit.bank : isEPF ? 'EPF' : 'PPF'}
                              </span>
                              {account && <span className="text-muted-foreground">• {account.name}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {isFD ? formatCurrency(deposit.principal || 0) : formatCurrency(balance)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {isFD ? 'Principal' : 'Balance'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-green-600">
                            {isFD ? formatCurrency(deposit.maturity_value || 0) : `${deposit.interest_rate}%`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {isFD ? 'Maturity' : 'Rate'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {isFD 
                              ? formatDate(deposit.maturity_date) 
                              : `${deposit.transactions.length} txns`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {isFD ? 'Matures' : 'Deposits'}
                          </div>
                        </div>
                        <div className="text-right" onClick={(e) => e.stopPropagation()}>
                          {!isFD && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAddDepositModal(deposit)}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Add
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t">
                        {isFD ? (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                              <div>
                                <div className="text-xs text-muted-foreground">Principal</div>
                                <div className="text-lg font-bold">{formatCurrency(deposit.principal || 0)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Interest Rate</div>
                                <div className="text-lg font-bold">{deposit.interest_rate}% p.a.</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Start Date</div>
                                <div className="text-sm font-medium">{formatDate(deposit.start_date)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Maturity Date</div>
                                <div className="text-sm font-medium">{formatDate(deposit.maturity_date)}</div>
                              </div>
                              <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Maturity Value</div>
                                <div className="text-2xl font-bold text-green-600">
                                  {formatCurrency(deposit.maturity_value || 0)}
                                </div>
                              </div>
                              <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">Interest Earned</div>
                                <div className="text-xl font-bold text-blue-600">
                                  {formatCurrency((deposit.maturity_value || 0) - (deposit.principal || 0))}
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end pt-2 border-t">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteDeposit(deposit.id, deposit.name)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete FD
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                              <div>
                                <div className="text-xs text-muted-foreground">Current Balance</div>
                                <div className="text-2xl font-bold text-green-600">
                                  {formatCurrency(balance)}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Interest Rate</div>
                                <div className="text-lg font-bold">{deposit.interest_rate}% p.a.</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">{isEPF ? 'UAN' : 'Account Number'}</div>
                                <div className="text-sm font-medium">
                                  {deposit.ppf_account_number || deposit.epf_account_number || 'N/A'}
                                </div>
                              </div>
                            </div>
                            
                            {deposit.transactions.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold mb-2">Recent Transactions</h4>
                                <div className="space-y-1">
                                  {deposit.transactions.slice(-5).reverse().map((txn, idx) => (
                                    <div key={idx} className="flex justify-between text-sm p-2 bg-muted/50 rounded">
                                      <span>{formatDate(txn.date)}</span>
                                      <span className="font-medium text-green-600">
                                        +{formatCurrency(txn.amount)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            <div className="flex justify-end pt-4 border-t mt-4">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDeleteDeposit(deposit.id, deposit.name)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete PPF
                              </Button>
                            </div>
                          </div>
                        )}
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

      {deposits.length === 0 && accounts.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Landmark className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No deposits yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              Add your first FD or PPF to start tracking
            </p>
            <Button onClick={() => setIsAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Deposit
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add Deposit Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Deposit"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Deposit Type</label>
            <select
              value={depositType}
              onChange={(e) => setDepositType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="fd">Fixed Deposit (FD)</option>
              <option value="ppf">Public Provident Fund (PPF)</option>
              <option value="epf">Employee Provident Fund (EPF)</option>
            </select>
          </div>

          {depositType === 'fd' ? (
            <form onSubmit={handleCreateFD} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">FD Name</label>
                <Input
                  value={fdFormData.name}
                  onChange={(e) => setFdFormData({ ...fdFormData, name: e.target.value })}
                  placeholder="e.g., SBI FD 2024"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Bank</label>
                <select
                  value={fdFormData.bank}
                  onChange={(e) => setFdFormData({ ...fdFormData, bank: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  <option value="">Select Bank</option>
                  {banks.map((bank) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Principal Amount</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fdFormData.principal}
                    onChange={(e) => setFdFormData({ ...fdFormData, principal: e.target.value })}
                    placeholder="e.g., 100000"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Interest Rate (%)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fdFormData.interest_rate}
                    onChange={(e) => setFdFormData({ ...fdFormData, interest_rate: e.target.value })}
                    placeholder="e.g., 7.5"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Start Date</label>
                  <DateInput
                    value={fdFormData.start_date}
                    onChange={(e) => setFdFormData({ ...fdFormData, start_date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Maturity Date</label>
                  <DateInput
                    value={fdFormData.maturity_date}
                    onChange={(e) => setFdFormData({ ...fdFormData, maturity_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Account</label>
                <select
                  value={fdFormData.account_id}
                  onChange={(e) => setFdFormData({ ...fdFormData, account_id: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  <option value="">Select Account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create FD</Button>
              </div>
            </form>
          ) : depositType === 'ppf' ? (
            <form onSubmit={handleCreatePPF} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">PPF Name</label>
                <Input
                  value={ppfFormData.name}
                  onChange={(e) => setPpfFormData({ ...ppfFormData, name: e.target.value })}
                  placeholder="e.g., My PPF Account"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Account Number (Optional)</label>
                <Input
                  value={ppfFormData.ppf_account_number}
                  onChange={(e) => setPpfFormData({ ...ppfFormData, ppf_account_number: e.target.value })}
                  placeholder="e.g., PPF123456789"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Interest Rate (%)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={ppfFormData.interest_rate}
                  onChange={(e) => setPpfFormData({ ...ppfFormData, interest_rate: e.target.value })}
                  placeholder="Current: 7.1%"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Current PPF rate is 7.1% (as of 2024)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Initial Balance (Optional)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={ppfFormData.initial_balance}
                  onChange={(e) => setPpfFormData({ ...ppfFormData, initial_balance: e.target.value })}
                  placeholder="e.g., 50000"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  If you have an existing PPF account, enter your current balance
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Account</label>
                <select
                  value={ppfFormData.account_id}
                  onChange={(e) => setPpfFormData({ ...ppfFormData, account_id: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  <option value="">Select Account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create PPF</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCreateEPF} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">EPF Name</label>
                <Input
                  value={epfFormData.name}
                  onChange={(e) => setEpfFormData({ ...epfFormData, name: e.target.value })}
                  placeholder="e.g., My EPF Account"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">UAN/Account Number (Optional)</label>
                <Input
                  value={epfFormData.epf_account_number}
                  onChange={(e) => setEpfFormData({ ...epfFormData, epf_account_number: e.target.value })}
                  placeholder="e.g., 123456789012"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Interest Rate (%)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={epfFormData.interest_rate}
                  onChange={(e) => setEpfFormData({ ...epfFormData, interest_rate: e.target.value })}
                  placeholder="Current: 8.25%"
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Current EPF rate is 8.25% (as of 2024)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Initial Balance (Optional)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={epfFormData.initial_balance}
                  onChange={(e) => setEpfFormData({ ...epfFormData, initial_balance: e.target.value })}
                  placeholder="e.g., 100000"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  If you have an existing EPF account, enter your current balance
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Account</label>
                <select
                  value={epfFormData.account_id}
                  onChange={(e) => setEpfFormData({ ...epfFormData, account_id: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                >
                  <option value="">Select Account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create EPF</Button>
              </div>
            </form>
          )}
        </div>
      </Modal>

      {/* Add Deposit to PPF Modal */}
      <Modal
        isOpen={isAddDepositModalOpen}
        onClose={() => setIsAddDepositModalOpen(false)}
        title={`Add Deposit - ${selectedPPF?.name}`}
      >
        <form onSubmit={handleAddDeposit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Type</label>
            <select
              value={depositFormData.type}
              onChange={(e) => setDepositFormData({ ...depositFormData, type: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="deposit">Deposit</option>
              <option value="interest">Interest Credit</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {depositFormData.type === 'deposit' 
                ? 'Regular deposit to PPF account'
                : 'Interest credited by bank/post office'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Date</label>
            <DateInput
              value={depositFormData.date}
              onChange={(e) => setDepositFormData({ ...depositFormData, date: e.target.value })}
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Amount</label>
            <Input
              type="number"
              step="0.01"
              value={depositFormData.amount}
              onChange={(e) => setDepositFormData({ ...depositFormData, amount: e.target.value })}
              placeholder="e.g., 50000"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Maximum ₹1,50,000 per financial year for PPF
            </p>
          </div>

          {depositFormData.amount && (
            <div className="p-3 bg-muted rounded-md">
              <div className="text-sm text-muted-foreground">
                {depositFormData.type === 'deposit' ? 'Deposit Amount' : 'Interest Amount'}
              </div>
              <div className="text-lg font-bold">
                {formatCurrency(parseFloat(depositFormData.amount))}
              </div>
              {depositFormData.type === 'deposit' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Max ₹1,50,000 per financial year
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsAddDepositModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {depositFormData.type === 'deposit' ? 'Add Deposit' : 'Add Interest'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { portfolioApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { Plus, Briefcase } from 'lucide-react';
import { formatCurrency, formatNumber } from '../lib/utils';

export function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [accountMetrics, setAccountMetrics] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const [accountsRes, dashboardRes] = await Promise.all([
        portfolioApi.getAccounts(),
        portfolioApi.getDashboard(),
      ]);
      
      setAccounts(accountsRes.data);
      
      // Create metrics map
      const metricsMap = {};
      dashboardRes.data.account_metrics.forEach(({ account, metrics }) => {
        metricsMap[account.id] = metrics;
      });
      setAccountMetrics(metricsMap);
    } catch (error) {
      console.error('Error loading accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await portfolioApi.createAccount(formData);
      setIsModalOpen(false);
      setFormData({ name: '', description: '' });
      loadAccounts();
    } catch (error) {
      console.error('Error creating account:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading accounts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Accounts</h2>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No accounts yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              Create your first account to start tracking investments
            </p>
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => {
            const metrics = accountMetrics[account.id] || {
              total_invested: 0,
              current_value: 0,
              absolute_return: 0,
              absolute_return_pct: 0,
              xirr: null,
              fund_count: 0,
            };
            const isPositive = metrics.absolute_return >= 0;

            return (
              <Card key={account.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{account.name}</CardTitle>
                  {account.description && (
                    <p className="text-sm text-muted-foreground">
                      {account.description}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm text-muted-foreground">Total Invested</div>
                      <div className="text-xl font-bold">
                        {formatCurrency(metrics.total_invested)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Current Value</div>
                      <div className="text-xl font-bold">
                        {formatCurrency(metrics.current_value)}
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Returns:</span>
                        <span className={`font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(metrics.absolute_return)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-muted-foreground">Returns %:</span>
                        <span className={`font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                          {formatNumber(metrics.absolute_return_pct, 2)}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-muted-foreground">XIRR:</span>
                        <span className="font-semibold">
                          {metrics.xirr !== null ? `${formatNumber(metrics.xirr, 2)}%` : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-muted-foreground">Funds:</span>
                        <span className="font-semibold">{metrics.fund_count}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Account"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Account Name</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Zerodha, Groww, etc."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Description (Optional)</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g., Primary investment account, Retirement savings, etc."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Accounts can hold multiple types of investments (MF, Stocks, FD, PPF, etc.)
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Account</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';
import { portfolioApi } from '../lib/api';
import { toast } from './ui/Toast';

export function RefreshPortfolio() {
  const [updating, setUpdating] = useState(false);

  const handleRefresh = async () => {
    setUpdating(true);
    
    try {
      // Get all funds
      const fundsResponse = await portfolioApi.getFunds();
      const funds = fundsResponse.data;
      
      // Update mutual funds (with scheme codes) and stocks (with symbols)
      const eligibleFunds = funds.filter(f => 
        (f.type === 'mutual_fund' && f.scheme_code) || 
        (f.type === 'stock' && (f.symbol || f.name))
      );
      
      if (eligibleFunds.length === 0) {
        toast.info('No funds with scheme codes or stock symbols to update');
        setUpdating(false);
        return;
      }

      const mutualFundCount = eligibleFunds.filter(f => f.type === 'mutual_fund').length;
      const stockCount = eligibleFunds.filter(f => f.type === 'stock').length;
      toast.info(`Updating NAV for ${mutualFundCount} mutual fund(s) and ${stockCount} stock(s)...`);
      
      let successCount = 0;
      let failCount = 0;

      for (const fund of eligibleFunds) {
        try {
          const result = await portfolioApi.updateNAV(fund.id);
          // Check if result indicates manual entry is required
          if (result && result.data && result.data.requiresManualEntry) {
            console.warn(`Stock price fetch unavailable for ${fund.name}: ${result.data.note}`);
            failCount++;
          } else {
            successCount++;
          }
        } catch (error) {
          console.error(`Error updating NAV for ${fund.name}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        const stockFailCount = eligibleFunds.filter(f => f.type === 'stock').length - successCount;
        let message = `Updated ${successCount} investment(s)`;
        if (failCount > 0) {
          if (stockFailCount > 0) {
            message += `. ${stockFailCount} stock(s) require manual price entry (not available in standalone app)`;
          } else {
            message += `, ${failCount} failed`;
          }
        }
        toast.success(message);
        // Reload the page to refresh all data
        window.location.reload();
      } else {
        const hasStocks = eligibleFunds.some(f => f.type === 'stock');
        if (hasStocks) {
          toast.info('Stock prices cannot be fetched automatically in standalone app. Please update prices manually by editing each stock fund.');
        } else {
          toast.error('Failed to update NAV for all investments');
        }
      }
    } catch (error) {
      console.error('Error refreshing portfolio:', error);
      toast.error('Failed to refresh portfolio');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleRefresh}
      disabled={updating}
      className="rounded-full"
      aria-label="Refresh portfolio NAV"
      title="Update NAV for all investments"
    >
      <RefreshCw className={`h-5 w-5 ${updating ? 'animate-spin' : ''}`} />
    </Button>
  );
}

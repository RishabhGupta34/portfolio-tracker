import { useEffect, useState } from 'react';
import { portfolioApi } from '../lib/api';
import { toast } from './ui/Toast';

/**
 * Component that automatically updates NAV on first app open
 * Runs silently in the background without blocking UI
 */
export function AutoRefreshNAV() {
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    // Only run once per app session
    if (hasRun) return;

    const autoUpdateNAV = async () => {
      try {
        // Check if we should auto-update (first time or NAVs are stale)
        const lastUpdateKey = 'lastNavAutoUpdate';
        const lastUpdateDate = localStorage.getItem(lastUpdateKey);
        const today = new Date().toISOString().split('T')[0];
        
        // Skip if already updated today
        if (lastUpdateDate === today) {
          console.log('NAV already updated today, skipping auto-update');
          setHasRun(true);
          return;
        }

        // Get all funds
        const fundsResponse = await portfolioApi.getFunds();
        const funds = fundsResponse.data;
        
        // Only update mutual funds (with scheme codes) - stocks require manual entry
        const eligibleFunds = funds.filter(f => 
          f.type === 'mutual_fund' && f.scheme_code
        );
        
        if (eligibleFunds.length === 0) {
          setHasRun(true);
          return;
        }

        console.log(`Auto-updating NAV for ${eligibleFunds.length} mutual fund(s)...`);
        
        let successCount = 0;
        let failCount = 0;

        // Update NAVs silently (no toast notifications)
        for (const fund of eligibleFunds) {
          try {
            const result = await portfolioApi.updateNAV(fund.id);
            // Check if result indicates manual entry is required
            if (result && result.data && result.data.requiresManualEntry) {
              failCount++;
            } else {
              successCount++;
            }
          } catch (error) {
            console.warn(`Auto-update failed for ${fund.name}:`, error);
            failCount++;
          }
        }

        // Mark as updated today
        localStorage.setItem(lastUpdateKey, today);
        
        if (successCount > 0) {
          console.log(`Auto-updated ${successCount} mutual fund(s)`);
          // Optionally show a subtle notification
          toast.success(`Updated ${successCount} investment(s)`, { duration: 2000 });
        }
      } catch (error) {
        console.error('Error during auto NAV update:', error);
      } finally {
        setHasRun(true);
      }
    };

    // Run after a short delay to not block initial render
    const timer = setTimeout(() => {
      autoUpdateNAV();
    }, 1000);

    return () => clearTimeout(timer);
  }, [hasRun]);

  // This component doesn't render anything
  return null;
}

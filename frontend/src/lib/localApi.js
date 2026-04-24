/**
 * Local API - replaces backend API calls with local storage and calculations
 * All data stored locally, no server needed
 */

import { getPortfolio, savePortfolio } from './storage';
import {
  calculateFundMetrics,
  calculateAccountMetrics,
  calculatePortfolioMetrics,
} from './calculations';

/**
 * Generate unique ID
 */
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Local API implementation
 */
export const localApi = {
  // Dashboard
  async getDashboard() {
    const portfolio = await getPortfolio();
    const portfolioMetrics = calculatePortfolioMetrics(portfolio);

    const accountMetrics = portfolio.accounts.map(account => ({
      account,
      metrics: calculateAccountMetrics(account.id, portfolio.funds),
    }));

    const fundMetrics = portfolio.funds
      .filter(f => !['fd', 'ppf', 'epf'].includes(f.type))
      .map(fund => ({
        fund,
        metrics: calculateFundMetrics(fund),
      }));

    return {
      portfolio_metrics: portfolioMetrics,
      account_metrics: accountMetrics,
      fund_metrics: fundMetrics,
    };
  },

  // Accounts
  async getAccounts() {
    const portfolio = await getPortfolio();
    return portfolio.accounts;
  },

  async createAccount(data) {
    const portfolio = await getPortfolio();
    const newAccount = {
      id: generateId('acc'),
      name: data.name,
      description: data.description || null,
    };
    portfolio.accounts.push(newAccount);
    await savePortfolio(portfolio);
    return newAccount;
  },

  async getAccountMetrics(accountId) {
    const portfolio = await getPortfolio();
    return calculateAccountMetrics(accountId, portfolio.funds);
  },

  // Funds
  async getFunds() {
    const portfolio = await getPortfolio();
    return portfolio.funds;
  },

  async getFund(fundId) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === fundId);
    if (!fund) {
      throw new Error('Fund not found');
    }
    return {
      fund,
      metrics: calculateFundMetrics(fund),
    };
  },

  async createFund(data) {
    const portfolio = await getPortfolio();
    
    // Verify account exists
    const account = portfolio.accounts.find(a => a.id === data.account_id);
    if (!account) {
      throw new Error('Account not found');
    }

    const newFund = {
      id: generateId('fund'),
      name: data.name,
      type: data.type,
      account_id: data.account_id,
      transactions: [],
      scheme_code: data.scheme_code || null,
      symbol: data.symbol || null,
      current_nav: null,
      previous_nav: null,
      nav_updated_at: null,
      interest_rate: data.interest_rate || null,
      maturity_date: data.maturity_date || null,
      bank: data.bank || null,
      principal: data.principal || null,
      start_date: data.start_date || null,
      maturity_value: null,
      ppf_account_number: data.ppf_account_number || null,
    };

    portfolio.funds.push(newFund);
    await savePortfolio(portfolio);
    return newFund;
  },

  async getFundMetrics(fundId) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === fundId);
    if (!fund) {
      throw new Error('Fund not found');
    }
    return calculateFundMetrics(fund);
  },

  // Transactions
  async addTransaction(data) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === data.fund_id);
    
    if (!fund) {
      throw new Error('Fund not found');
    }

    const amount = ['bonus', 'split'].includes(data.transaction_type)
      ? 0
      : data.units * data.nav;

    // Handle stock splits
    let splitNav = data.nav;
    if (data.transaction_type === 'split' && data.split_ratio) {
      try {
        const [oldShares, newShares] = data.split_ratio.split(':').map(Number);
        const multiplier = newShares / oldShares;

        // Adjust all transactions before this split
        for (const txn of fund.transactions) {
          if (txn.date < data.date && ['buy', 'sell', 'bonus'].includes(txn.transaction_type)) {
            txn.units = txn.units * multiplier;
            txn.nav = txn.nav / multiplier;
          }
        }

        // Calculate split NAV
        let totalUnitsBefore = 0;
        let totalInvested = 0;
        for (const txn of fund.transactions) {
          if (txn.date < data.date) {
            if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
              totalUnitsBefore += txn.units;
              totalInvested += txn.amount;
            } else if (txn.transaction_type === 'sell') {
              totalUnitsBefore -= txn.units;
              totalInvested -= txn.amount;
            }
          }
        }

        if (totalUnitsBefore > 0) {
          const avgNavBefore = totalInvested / totalUnitsBefore;
          splitNav = avgNavBefore / multiplier;
        }
      } catch (e) {
        console.error('Error processing split:', e);
      }
    }

    const newTransaction = {
      id: generateId('txn'),
      date: data.date,
      units: data.units,
      nav: splitNav,
      amount: amount,
      transaction_type: data.transaction_type,
      split_ratio: data.split_ratio || null,
      notes: data.notes || null,
    };

    fund.transactions.push(newTransaction);
    fund.transactions.sort((a, b) => a.date.localeCompare(b.date));
    await savePortfolio(portfolio);

    return newTransaction;
  },

  async deleteTransaction(fundId, transactionId) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === fundId);
    
    if (!fund) {
      throw new Error('Fund not found');
    }

    fund.transactions = fund.transactions.filter(t => t.id !== transactionId);
    await savePortfolio(portfolio);

    return { message: 'Transaction deleted successfully' };
  },

  async deleteFund(fundId) {
    const portfolio = await getPortfolio();
    portfolio.funds = portfolio.funds.filter(f => f.id !== fundId);
    await savePortfolio(portfolio);
    return { message: 'Investment deleted successfully' };
  },

  // Portfolio metrics
  async getPortfolioMetrics() {
    const portfolio = await getPortfolio();
    return calculatePortfolioMetrics(portfolio);
  },

  // NAV/Price fetching - these still need network, but can be optional
  async searchMutualFund(fundName) {
    try {
      let schemes;
      // Try CapacitorHttp first for native iOS
      try {
        const { CapacitorHttp, Capacitor } = await import('@capacitor/core');
        if (Capacitor.isNativePlatform()) {
          const response = await CapacitorHttp.get({
            url: 'https://api.mfapi.in/mf',
            headers: { 'Accept': 'application/json' },
          });
          schemes = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        }
      } catch (e) { /* fallback below */ }

      if (!schemes) {
        const response = await fetch('https://api.mfapi.in/mf');
        schemes = await response.json();
      }

      // Split query into words — ALL words must be present (in any order)
      const words = fundName.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = schemes
        .filter(scheme => {
          const name = scheme.schemeName.toLowerCase();
          return words.every(w => name.includes(w));
        })
        .slice(0, 50)
        .map(scheme => ({
          scheme_code: scheme.schemeCode,
          scheme_name: scheme.schemeName,
        }));
      return { results: matches };
    } catch (e) {
      console.error('Error searching mutual funds:', e);
      return { results: [] };
    }
  },

  async getMutualFundNAV(schemeCode) {
    try {
      const response = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
      const data = await response.json();
      if (data && data.data && data.data.length > 0) {
        const latest = data.data[0];
        return {
          nav: parseFloat(latest.nav),
          date: latest.date,
          scheme_name: data.meta?.scheme_name || '',
        };
      }
      throw new Error('NAV data not found');
    } catch (e) {
      throw new Error('Could not fetch NAV: ' + e.message);
    }
  },

  async getStockPrice(symbol) {
    // For Indian stocks, try multiple approaches to fetch prices
    // Format: For NSE stocks, symbol format is "SYMBOL.NS" (e.g., "RELIANCE.NS")
    // For BSE stocks, symbol format is "SYMBOL.BO" (e.g., "RELIANCE.BO")
    
    let formattedSymbol = symbol;
    if (!symbol.includes('.')) {
      // Assume NSE if no exchange specified
      formattedSymbol = `${symbol}.NS`;
    }
    
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${formattedSymbol}?interval=1d&range=1d`;
    
    // Helper function to parse Yahoo Finance response
    const parseYahooResponse = (data) => {
      const result = data.chart?.result?.[0];
      if (result && result.meta) {
        const price = result.meta.regularMarketPrice || result.meta.previousClose;
        if (price) {
          return {
            price: price,
            date: result.meta.regularMarketTime 
              ? new Date(result.meta.regularMarketTime * 1000).toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
            symbol: symbol
          };
        }
      }
      return null;
    };
    
    // Try CapacitorHttp first (bypasses CORS in native iOS app)
    try {
      const { CapacitorHttp, Capacitor } = await import('@capacitor/core');
      
      if (Capacitor.isNativePlatform()) {
        // Removed console.log (privacy)
        const response = await CapacitorHttp.get({
          url: yahooUrl,
          headers: {
            'Accept': '*/*',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });
        
        // Removed console.log (privacy)
        
        if (response.status === 200 && response.data) {
          const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          const result = parseYahooResponse(data);
          if (result) {
            // Removed console.log (privacy)
            return result;
          }
        }
      }
    } catch (capacitorError) {
      console.warn('CapacitorHttp failed:', capacitorError.message || capacitorError);
    }
    
    // Fallback: Try XMLHttpRequest
    try {
      // Removed console.log (privacy)
      const xhrResult = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', yahooUrl, true);
        xhr.setRequestHeader('Accept', '*/*');
        xhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        xhr.onload = () => {
          if (xhr.status === 200 && xhr.readyState === 4) {
            try {
              const data = JSON.parse(xhr.responseText);
              const result = parseYahooResponse(data);
              if (result) {
                // Removed console.log (privacy)
                resolve(result);
              } else {
                reject(new Error('No price data in response'));
              }
            } catch (e) {
              reject(new Error('Failed to parse response: ' + e.message));
            }
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.ontimeout = () => reject(new Error('Request timeout'));
        xhr.timeout = 15000;
        xhr.send();
      });
      
      if (xhrResult) return xhrResult;
    } catch (xhrError) {
      console.warn('XMLHttpRequest failed:', xhrError.message);
    }
    
    // Fallback: Try regular fetch
    try {
      // Removed console.log (privacy)
      const response = await fetch(yahooUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        mode: 'cors'
      });
      
      if (response.ok) {
        const data = await response.json();
        const result = parseYahooResponse(data);
        if (result) {
          // Removed console.log (privacy)
          return result;
        }
      } else {
        console.warn(`Fetch failed with status: ${response.status}`);
      }
    } catch (fetchError) {
      console.warn('Direct fetch failed:', fetchError.message || fetchError);
    }
    
    // Try BSE if NSE fails
    if (formattedSymbol.endsWith('.NS')) {
      const bseSymbol = formattedSymbol.replace('.NS', '.BO');
      const bseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${bseSymbol}?interval=1d&range=1d`;
      
      try {
        const { CapacitorHttp } = await import('@capacitor/core');
        const { Capacitor } = await import('@capacitor/core');
        
        if (Capacitor.isNativePlatform()) {
          // Removed console.log (privacy)
          const response = await CapacitorHttp.get({
            url: bseUrl,
            headers: {
              'Accept': '*/*',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          
          if (response.status === 200 && response.data) {
            const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            const result = parseYahooResponse(data);
            if (result) {
              // Removed console.log (privacy)
              return result;
            }
          }
        }
      } catch (bseError) {
        console.warn('BSE CapacitorHttp failed:', bseError.message);
      }
    }
    
    // If all approaches fail, throw error
    throw new Error(`Unable to fetch stock price for ${symbol}. Please enter price manually. Make sure the stock symbol is correct (e.g., "RELIANCE" for NSE or "RELIANCE.NS").`);
  },

  async updateNAV(fundId) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === fundId);
    
    if (!fund) {
      throw new Error('Fund not found');
    }

    let currentNav = null;
    let navDate = null;

    if (fund.type === 'mutual_fund') {
      if (!fund.scheme_code) {
        return {
          message: 'Scheme code not set for this fund',
          note: 'Please search and set scheme code when creating the fund',
        };
      }
      const navData = await this.getMutualFundNAV(fund.scheme_code);
      currentNav = navData.nav;
      navDate = navData.date;
    } else if (fund.type === 'stock') {
      // Try to get symbol - use fund.symbol if available, otherwise try to derive from name
      let stockSymbol = fund.symbol;
      
      if (!stockSymbol && fund.name) {
        // Try to derive symbol from name (remove common suffixes and convert to uppercase)
        stockSymbol = fund.name
          .replace(/\s+(Limited|Ltd\.?|Ltd|Incorporated|Inc\.?|Corporation|Corp\.?)$/i, '')
          .replace(/\s+/g, '')
          .toUpperCase();
        
        // Removed console.log (privacy)
      }
      
      if (!stockSymbol) {
        return {
          message: 'Stock symbol not set for this fund',
          note: `Please set the stock symbol for ${fund.name}. You can edit the fund and add the NSE ticker symbol (e.g., "HDFCBANK" for HDFC Bank Limited).`,
        };
      }
      
      try {
        // Removed console.log (privacy)
        const stockData = await this.getStockPrice(stockSymbol);
        currentNav = stockData.price;
        navDate = stockData.date;
        // Removed console.log (privacy)
      } catch (error) {
        console.error(`Failed to fetch stock price for ${stockSymbol} (${fund.name}):`, error);
        // Stock price fetching failed - return message for manual entry
        return {
          message: 'Stock price fetching failed',
          note: `Unable to fetch stock price for ${fund.name} (symbol: ${stockSymbol}). Error: ${error.message}. Please update the price manually by editing the fund and setting the current NAV directly.`,
          requiresManualEntry: true,
          fundName: fund.name,
          symbol: stockSymbol
        };
      }
    }

    if (currentNav) {
      const today = navDate || new Date().toISOString().split('T')[0];
      const lastUpdateDate = fund.nav_updated_at || null;
      
      // Only update previous_nav if this is a new day (different from last update date)
      // This ensures day change is calculated against yesterday's closing NAV, not the previous update
      if (fund.current_nav && lastUpdateDate && lastUpdateDate !== today) {
        // New day: save current_nav as previous_nav (yesterday's closing NAV)
        fund.previous_nav = fund.current_nav;
      } else if (!fund.previous_nav && fund.current_nav) {
        // If previous_nav is not set but we have current_nav, set it
        // This handles the case where previous_nav wasn't set on first update
        // Note: This means first update won't show day change, but subsequent updates will
        fund.previous_nav = fund.current_nav;
      }
      // If updating on the same day, keep previous_nav as is (yesterday's closing NAV)
      
      const oldCurrentNav = fund.current_nav;
      fund.current_nav = currentNav;
      fund.nav_updated_at = today;
      await savePortfolio(portfolio);

      // Calculate day change using previous_nav (which should be yesterday's closing NAV)
      // During market hours, this will show current price vs yesterday's closing price
      const dayChange = fund.previous_nav ? currentNav - fund.previous_nav : null;
      const dayChangePct = fund.previous_nav ? (dayChange / fund.previous_nav) * 100 : null;
      
      // Removed console.log for day change (privacy)

      return {
        message: 'NAV updated successfully',
        current_nav: currentNav,
        previous_nav: fund.previous_nav,
        day_change: dayChange,
        day_change_pct: dayChangePct,
        nav_date: navDate || new Date().toISOString().split('T')[0],
        fund_name: fund.name,
      };
    }

    throw new Error('Could not fetch current NAV/price');
  },

  // Charts
  async getPortfolioTimeline(accountId = null, fundType = null) {
    const portfolio = await getPortfolio();
    const { matchesTypeFilter } = await import('./fundUtils');
    let filteredFunds = portfolio.funds.filter(f => !['fd', 'ppf', 'epf'].includes(f.type));
    
    if (accountId && accountId !== 'all') {
      filteredFunds = filteredFunds.filter(f => f.account_id === accountId);
    }
    if (fundType && fundType !== 'all') {
      filteredFunds = filteredFunds.filter(f => matchesTypeFilter(f, fundType));
    }

    if (filteredFunds.length === 0) {
      return { timeline: [] };
    }

    // Collect all transaction dates
    const allDates = new Set();
    for (const fund of filteredFunds) {
      for (const txn of fund.transactions) {
        allDates.add(txn.date);
      }
    }
    allDates.add(new Date().toISOString().split('T')[0]);

    const sortedDates = Array.from(allDates).sort();
    const timeline = [];

    for (const targetDate of sortedDates) {
      let totalInvested = 0;
      let totalValue = 0;

      for (const fund of filteredFunds) {
        const relevantTxns = fund.transactions.filter(t => t.date <= targetDate);
        if (relevantTxns.length === 0) continue;

        let invested = 0;
        let units = 0;

        for (const txn of relevantTxns) {
          if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
            invested += txn.amount;
            units += txn.units;
          } else if (txn.transaction_type === 'sell') {
            if (units > 0) {
              invested -= (txn.units / units) * invested;
            }
            units -= txn.units;
          }
        }

        if (units <= 0) continue;

        const latestNav = fund.current_nav || (relevantTxns.length > 0 ? relevantTxns[relevantTxns.length - 1].nav : 0);
        const currentValue = units * latestNav;

        totalInvested += invested;
        totalValue += currentValue;
      }

      // Calculate XIRR for this point in time
      let xirr = null;
      if (totalInvested > 0 && totalValue > 0) {
        try {
          // Collect all transactions up to this date for XIRR calculation
          const allTransactions = [];
          for (const fund of filteredFunds) {
            const relevantTxns = fund.transactions.filter(t => t.date <= targetDate);
            for (const txn of relevantTxns) {
              // Pass transactions as-is; calculateXIRR handles sign conversion
              allTransactions.push({
                date: txn.date,
                amount: txn.amount,
                transaction_type: txn.transaction_type
              });
            }
          }
          
          // Calculate XIRR (calculateXIRR adds currentValue internally)
          if (allTransactions.length > 0) {
            const { calculateXIRR } = await import('./calculations');
            xirr = calculateXIRR(allTransactions, totalValue, targetDate);
          }
        } catch (error) {
          console.warn('XIRR calculation failed for date', targetDate, error);
          xirr = null;
        }
      }

      timeline.push({
        date: targetDate,
        invested: Math.round(totalInvested * 100) / 100,
        value: Math.round(totalValue * 100) / 100,
        returns: Math.round((totalValue - totalInvested) * 100) / 100,
        returns_pct: totalInvested > 0 ? Math.round(((totalValue - totalInvested) / totalInvested) * 100 * 100) / 100 : 0,
        xirr: xirr !== null && !isNaN(xirr) && isFinite(xirr) ? Math.round(xirr * 100) / 100 : null,
      });
    }

    return { timeline };
  },

  async getAccountAllocation() {
    const portfolio = await getPortfolio();
    const allocations = [];

    for (const account of portfolio.accounts) {
      const accountFunds = portfolio.funds.filter(
        f => f.account_id === account.id && !['fd', 'ppf', 'epf'].includes(f.type)
      );
      const metrics = calculateAccountMetrics(account.id, accountFunds);
      if (metrics.current_value > 0) {
        allocations.push({
          name: account.name,
          value: metrics.current_value,
          invested: metrics.total_invested,
          returns: metrics.absolute_return,
        });
      }
    }

    return { allocations };
  },

  async getFundPerformance() {
    const portfolio = await getPortfolio();
    const { getEffectiveType } = await import('./fundUtils');
    const performances = [];

    for (const fund of portfolio.funds) {
      if (['fd', 'ppf', 'epf'].includes(fund.type)) continue;

      const metrics = calculateFundMetrics(fund);
      if (metrics.total_invested > 0 && metrics.current_units > 0) {
        performances.push({
          name: fund.name,
          invested: metrics.total_invested,
          current_value: metrics.current_value,
          returns: metrics.absolute_return,
          returns_pct: metrics.absolute_return_pct,
          xirr: metrics.xirr,
          type: fund.type, // Keep original type for NAV refresh
          effective_type: getEffectiveType(fund), // Effective type for filtering
        });
      }
    }

    performances.sort((a, b) => b.returns_pct - a.returns_pct);
    return { performances };
  },

  async getRealizedGains() {
    const portfolio = await getPortfolio();
    const realizedGains = [];
    let totalRealizedGain = 0;
    let totalSoldAmount = 0;
    let totalCostBasis = 0;

    for (const fund of portfolio.funds) {
      const buyQueue = [];
      const fundRealizedGains = [];

      for (const txn of [...fund.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
        if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
          buyQueue.push({
            units: txn.units,
            nav: txn.nav,
            date: txn.date,
            amount: txn.amount,
          });
        } else if (txn.transaction_type === 'sell') {
          let remainingUnits = txn.units;
          let costBasis = 0;

          while (remainingUnits > 0 && buyQueue.length > 0) {
            const oldestBuy = buyQueue[0];

            if (oldestBuy.units <= remainingUnits) {
              costBasis += oldestBuy.amount;
              remainingUnits -= oldestBuy.units;
              buyQueue.shift();
            } else {
              const proportion = remainingUnits / oldestBuy.units;
              costBasis += oldestBuy.amount * proportion;
              oldestBuy.units -= remainingUnits;
              oldestBuy.amount -= oldestBuy.amount * proportion;
              remainingUnits = 0;
            }
          }

          const sellAmount = txn.amount;
          const realizedGain = sellAmount - costBasis;
          const gainPct = costBasis > 0 ? (realizedGain / costBasis) * 100 : 0;

          fundRealizedGains.push({
            date: txn.date,
            units: txn.units,
            sell_nav: txn.nav,
            sell_amount: sellAmount,
            cost_basis: costBasis,
            realized_gain: realizedGain,
            gain_pct: gainPct,
          });

          totalRealizedGain += realizedGain;
          totalSoldAmount += sellAmount;
          totalCostBasis += costBasis;
        }
      }

      if (fundRealizedGains.length > 0) {
        const fundTotalGain = fundRealizedGains.reduce((sum, g) => sum + g.realized_gain, 0);
        const fundTotalSold = fundRealizedGains.reduce((sum, g) => sum + g.sell_amount, 0);
        const fundTotalCost = fundRealizedGains.reduce((sum, g) => sum + g.cost_basis, 0);

        realizedGains.push({
          fund_id: fund.id,
          fund_name: fund.name,
          fund_type: fund.type,
          account_id: fund.account_id,
          transactions: fundRealizedGains,
          total_realized_gain: Math.round(fundTotalGain * 100) / 100,
          total_sold_amount: Math.round(fundTotalSold * 100) / 100,
          total_cost_basis: Math.round(fundTotalCost * 100) / 100,
          gain_pct: fundTotalCost > 0 ? Math.round((fundTotalGain / fundTotalCost) * 100 * 100) / 100 : 0,
        });
      }
    }

    realizedGains.sort((a, b) => b.total_realized_gain - a.total_realized_gain);

    return {
      summary: {
        total_realized_gain: Math.round(totalRealizedGain * 100) / 100,
        total_sold_amount: Math.round(totalSoldAmount * 100) / 100,
        total_cost_basis: Math.round(totalCostBasis * 100) / 100,
        overall_gain_pct: totalCostBasis > 0 ? Math.round((totalRealizedGain / totalCostBasis) * 100 * 100) / 100 : 0,
        funds_with_sales: realizedGains.length,
      },
      funds: realizedGains,
    };
  },

  // Additional endpoints
  async getBanks() {
    return {
      banks: [
        'State Bank of India (SBI)',
        'HDFC Bank',
        'ICICI Bank',
        'Axis Bank',
        'Kotak Mahindra Bank',
        'Punjab National Bank (PNB)',
        'Bank of Baroda',
        'Canara Bank',
        'Union Bank of India',
        'Bank of India',
        'Indian Bank',
        'Central Bank of India',
        'IDBI Bank',
        'Yes Bank',
        'IndusInd Bank',
        'Post Office',
        'Other',
      ],
    };
  },

  async calculateInterest(fundId) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === fundId);
    
    if (!fund) {
      throw new Error('Fund not found');
    }

    if (!['ppf', 'fd', 'epf'].includes(fund.type)) {
      throw new Error('Interest calculation only available for PPF/FD/EPF');
    }

    if (!fund.interest_rate) {
      throw new Error('Interest rate not set for this fund');
    }

    const totalPrincipal = fund.transactions
      .filter(t => t.transaction_type === 'buy')
      .reduce((sum, t) => sum + t.amount, 0);

    if (totalPrincipal === 0) {
      throw new Error('No deposits found');
    }

    const annualRate = fund.interest_rate / 100;
    const interest = totalPrincipal * annualRate;

    const interestTransaction = {
      id: generateId('txn'),
      date: new Date().toISOString().split('T')[0],
      transaction_type: 'buy',
      units: interest,
      nav: 1.0,
      amount: interest,
    };

    fund.transactions.push(interestTransaction);
    await savePortfolio(portfolio);

    return {
      message: 'Interest calculated and added',
      interest_amount: Math.round(interest * 100) / 100,
      transaction_id: interestTransaction.id,
    };
  },

  async calculateFDMaturity(fundId) {
    const portfolio = await getPortfolio();
    const fund = portfolio.funds.find(f => f.id === fundId);
    
    if (!fund) {
      throw new Error('Fund not found');
    }

    if (fund.type !== 'fd') {
      throw new Error('Only for FD type');
    }

    if (!fund.principal || !fund.interest_rate || !fund.start_date || !fund.maturity_date) {
      throw new Error('Missing FD details (principal, rate, dates)');
    }

    const start = new Date(fund.start_date);
    const maturity = new Date(fund.maturity_date);
    const days = Math.floor((maturity - start) / (1000 * 60 * 60 * 24));
    const years = days / 365;

    const principal = fund.principal;
    const rate = fund.interest_rate / 100;
    const n = 4; // Quarterly compounding
    const maturityValue = principal * Math.pow(1 + rate / n, n * years);
    const interest = maturityValue - principal;

    fund.maturity_value = maturityValue;
    await savePortfolio(portfolio);

    return {
      principal: Math.round(principal * 100) / 100,
      interest_rate: fund.interest_rate,
      tenure_days: days,
      tenure_years: Math.round(years * 100) / 100,
      interest_earned: Math.round(interest * 100) / 100,
      maturity_value: Math.round(maturityValue * 100) / 100,
    };
  },
};



/**
 * Portfolio calculation functions - JavaScript version
 * All backend logic converted to run client-side
 */

/**
 * Calculate XIRR using Newton's method
 * Ported from Python backend
 */
export function calculateXIRR(transactions, currentValue, endDate = null) {
  if (!transactions || transactions.length === 0) {
    return null;
  }

  // Filter and sort transactions by date
  const validTransactions = transactions.filter(t => t.amount > 0);
  if (validTransactions.length === 0) {
    return null;
  }

  // Create cash flows and dates
  const cashFlows = [];
  const dates = [];

  for (const txn of validTransactions) {
    if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
      cashFlows.push(-txn.amount); // Negative for investments
      dates.push(new Date(txn.date));
    } else if (txn.transaction_type === 'sell') {
      cashFlows.push(txn.amount); // Positive for redemptions
      dates.push(new Date(txn.date));
    }
  }

  // Skip if no cash flows
  if (cashFlows.length === 0) {
    return null;
  }

  // Add current value as final positive cash flow
  if (currentValue > 0) {
    const finalDate = endDate ? new Date(endDate) : new Date();
    cashFlows.push(currentValue);
    dates.push(finalDate);
  } else {
    return null;
  }

  // Calculate days from first transaction
  const firstDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const days = dates.map(d => Math.floor((d - firstDate) / (1000 * 60 * 60 * 24)));

  // If holding period is less than 7 days, XIRR is not meaningful
  if (Math.max(...days) < 7) {
    return null;
  }

  // Check if all cash flows are the same sign
  if (cashFlows.every(cf => cf <= 0) || cashFlows.every(cf => cf >= 0)) {
    return null;
  }

  // XIRR calculation using Newton's method
  function xirrFormula(rate) {
    try {
      let sum = 0;
      for (let i = 0; i < cashFlows.length; i++) {
        sum += cashFlows[i] / Math.pow(1 + rate, days[i] / 365.0);
      }
      return sum;
    } catch (e) {
      return Infinity;
    }
  }

  function xirrDerivative(rate) {
    try {
      let sum = 0;
      for (let i = 0; i < cashFlows.length; i++) {
        const term = days[i] / 365.0;
        sum -= (cashFlows[i] * term) / Math.pow(1 + rate, term + 1);
      }
      return sum;
    } catch (e) {
      return 0;
    }
  }

  // Newton's method implementation
  function newtonMethod(f, fPrime, initialGuess, maxIter = 100, tolerance = 1e-6) {
    let x = initialGuess;
    for (let i = 0; i < maxIter; i++) {
      const fx = f(x);
      if (Math.abs(fx) < tolerance) {
        return x;
      }
      const fpx = fPrime(x);
      if (Math.abs(fpx) < 1e-10) {
        return null; // Derivative too small
      }
      x = x - fx / fpx;
      // Prevent extreme values
      if (x < -0.99 || x > 10) {
        return null;
      }
    }
    return null;
  }

  // Try multiple initial guesses
  const initialGuesses = [0.1, 0.0, -0.1, 0.5, -0.5];
  for (const guess of initialGuesses) {
    try {
      const rate = newtonMethod(xirrFormula, xirrDerivative, guess);
      if (rate !== null && rate >= -0.99 && rate <= 10.0) {
        return Math.round(rate * 100 * 100) / 100; // Return as percentage
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}

/**
 * Calculate fund metrics
 */
export function calculateFundMetrics(fund, historicalData = null) {
  if (!fund.transactions || fund.transactions.length === 0) {
    return {
      total_invested: 0,
      current_units: 0,
      current_value: 0,
      absolute_return: 0,
      absolute_return_pct: 0,
      xirr: null,
      avg_nav: 0,
      latest_nav: 0,
      day_change: null,
      day_change_pct: null,
    };
  }

  let totalInvested = 0;
  let currentUnits = 0;

  for (const txn of fund.transactions) {
    if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
      totalInvested += txn.amount;
      currentUnits += txn.units;
    } else if (txn.transaction_type === 'sell') {
      if (currentUnits > 0) {
        totalInvested -= (txn.units / currentUnits) * totalInvested;
      }
      currentUnits -= txn.units;
    }
  }

  // Get latest NAV
  const latestNav = fund.current_nav !== null && fund.current_nav !== undefined
    ? fund.current_nav
    : (fund.transactions.length > 0 ? fund.transactions[fund.transactions.length - 1].nav : 0);

  const currentValue = currentUnits * latestNav;
  const absoluteReturn = currentValue - totalInvested;
  const absoluteReturnPct = totalInvested > 0 ? (absoluteReturn / totalInvested) * 100 : 0;
  const avgNav = currentUnits > 0 ? totalInvested / currentUnits : 0;

  const xirr = calculateXIRR(fund.transactions, currentValue);

  // Calculate day change
  let dayChange = null;
  let dayChangePct = null;

  if (fund.current_nav && currentUnits > 0) {
    // Priority 1: Use previous_nav if set (should be yesterday's closing NAV)
    let yesterdayNav = fund.previous_nav;

    // Priority 2: Try to get from historical data if previous_nav is not set
    if (!yesterdayNav && historicalData && (fund.scheme_code || fund.symbol)) {
      try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (historicalData[fund.id] && historicalData[fund.id][yesterdayStr]) {
          yesterdayNav = historicalData[fund.id][yesterdayStr];
        } else if (historicalData[fund.id]) {
          // Get the most recent NAV before today
          const availableDates = Object.keys(historicalData[fund.id])
            .filter(d => d < new Date().toISOString().split('T')[0])
            .sort();
          if (availableDates.length > 0) {
            yesterdayNav = historicalData[fund.id][availableDates[availableDates.length - 1]];
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    // Calculate day change: current value vs yesterday's value
    if (yesterdayNav) {
      const previousValue = currentUnits * yesterdayNav;
      dayChange = currentValue - previousValue;
      dayChangePct = previousValue > 0 ? (dayChange / previousValue) * 100 : 0;
    }
  }

  return {
    total_invested: Math.round(totalInvested * 100) / 100,
    current_units: Math.round(currentUnits * 10000) / 10000,
    current_value: Math.round(currentValue * 100) / 100,
    absolute_return: Math.round(absoluteReturn * 100) / 100,
    absolute_return_pct: Math.round(absoluteReturnPct * 100) / 100,
    xirr: xirr !== null && (isNaN(xirr) || !isFinite(xirr)) ? null : xirr,
    avg_nav: Math.round(avgNav * 100) / 100,
    latest_nav: Math.round(latestNav * 100) / 100,
    day_change: dayChange !== null ? Math.round(dayChange * 100) / 100 : null,
    day_change_pct: dayChangePct !== null ? Math.round(dayChangePct * 100) / 100 : null,
  };
}

/**
 * Calculate account metrics
 */
export function calculateAccountMetrics(accountId, funds, historicalData = null) {
  const accountFunds = funds.filter(
    f => f.account_id === accountId && !['fd', 'ppf', 'epf'].includes(f.type)
  );

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

  let totalInvested = 0;
  let currentValue = 0;
  const allTransactions = [];

  for (const fund of accountFunds) {
    const metrics = calculateFundMetrics(fund, historicalData);
    if (metrics.current_units > 0) {
      totalInvested += metrics.total_invested;
      currentValue += metrics.current_value;
      allTransactions.push(...fund.transactions);
    }
  }

  const absoluteReturn = currentValue - totalInvested;
  const absoluteReturnPct = totalInvested > 0 ? (absoluteReturn / totalInvested) * 100 : 0;

  allTransactions.sort((a, b) => a.date.localeCompare(b.date));
  const xirr = calculateXIRR(allTransactions, currentValue);

  return {
    total_invested: Math.round(totalInvested * 100) / 100,
    current_value: Math.round(currentValue * 100) / 100,
    absolute_return: Math.round(absoluteReturn * 100) / 100,
    absolute_return_pct: Math.round(absoluteReturnPct * 100) / 100,
    xirr: xirr,
    fund_count: accountFunds.length,
  };
}

/**
 * Calculate portfolio metrics
 */
export function calculatePortfolioMetrics(portfolio, historicalData = null) {
  const investmentFunds = portfolio.funds.filter(f => !['fd', 'ppf', 'epf'].includes(f.type));

  if (investmentFunds.length === 0) {
    return {
      total_invested: 0,
      current_value: 0,
      absolute_return: 0,
      absolute_return_pct: 0,
      day_change: 0,
      day_change_pct: 0,
      xirr: null,
      account_count: portfolio.accounts.length,
      fund_count: 0,
    };
  }

  let totalInvested = 0;
  let currentValue = 0;
  const allTransactions = [];
  let totalDayChange = 0;

  for (const fund of investmentFunds) {
    const metrics = calculateFundMetrics(fund, historicalData);
    if (metrics.current_units > 0) {
      totalInvested += metrics.total_invested;
      currentValue += metrics.current_value;
      allTransactions.push(...fund.transactions);
      if (metrics.day_change !== null) {
        totalDayChange += metrics.day_change;
      }
    }
  }

  const absoluteReturn = currentValue - totalInvested;
  const absoluteReturnPct = totalInvested > 0 ? (absoluteReturn / totalInvested) * 100 : 0;

  const previousPortfolioValue = currentValue - totalDayChange;
  const dayChangePct = previousPortfolioValue > 0 ? (totalDayChange / previousPortfolioValue) * 100 : 0;

  allTransactions.sort((a, b) => a.date.localeCompare(b.date));
  const xirr = calculateXIRR(allTransactions, currentValue);

  return {
    total_invested: Math.round(totalInvested * 100) / 100,
    current_value: Math.round(currentValue * 100) / 100,
    absolute_return: Math.round(absoluteReturn * 100) / 100,
    absolute_return_pct: Math.round(absoluteReturnPct * 100) / 100,
    day_change: Math.round(totalDayChange * 100) / 100,
    day_change_pct: Math.round(dayChangePct * 100) / 100,
    xirr: xirr,
    account_count: portfolio.accounts.length,
    fund_count: investmentFunds.length,
  };
}



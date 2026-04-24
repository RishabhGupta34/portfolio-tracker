/**
 * Utility functions for fund categorization and filtering
 */

/**
 * Check if a fund should be treated as gold/silver based on its name
 * @param {string} fundName - Name of the fund
 * @returns {boolean}
 */
export function isGoldFund(fundName) {
  if (!fundName) return false;
  const name = fundName.toLowerCase().trim();
  const goldKeywords = [
    'gold', 
    'silver', 
    'gld', 
    'slv', 
    'precious metal',
    'precious',
    'etf gold',
    'gold etf',
    'silver etf',
    'etf silver',
    'hdfc gold',
    'hdfc silver',
    'sbi gold',
    'sbi silver',
    'nifty gold',
    'nifty silver',
    'hdfcgold',
    'hdfcsilver',
    'sbigold',
    'sbisilver',
    'goldbees',
    'silverbees'
  ];
  const isGold = goldKeywords.some(keyword => name.includes(keyword));
  if (isGold) {
    // Removed console.log (privacy)
  }
  return isGold;
}

/**
 * Get the effective type for filtering purposes
 * Funds with "gold" keyword are treated as gold type for filtering,
 * but keep their original type (MF/stock) for NAV refresh
 * @param {Object} fund - Fund object
 * @returns {string} Effective type for filtering
 */
export function getEffectiveType(fund) {
  if (isGoldFund(fund.name)) {
    return 'gold';
  }
  return fund.type;
}

/**
 * Check if a fund matches the type filter
 * @param {Object} fund - Fund object
 * @param {string|string[]} filterType - Type filter ('all', specific type, or array of types)
 * @returns {boolean}
 */
export function matchesTypeFilter(fund, filterType) {
  // Handle array of types (multi-select)
  if (Array.isArray(filterType)) {
    if (filterType.length === 0 || filterType.includes('all')) return true;
    return filterType.some(type => matchesTypeFilter(fund, type));
  }
  
  // Handle single type
  if (filterType === 'all') return true;
  if (filterType === 'gold') {
    // Show gold funds (those with gold keyword)
    return isGoldFund(fund.name) || isGoldFund(fund.symbol) || isGoldFund(fund.scheme_code);
  }
  // For other types, check both actual type and effective type
  // This allows filtering gold MF/stocks as gold, but also filtering by actual type
  return fund.type === filterType && !isGoldFund(fund.name) && !isGoldFund(fund.symbol) && !isGoldFund(fund.scheme_code);
}

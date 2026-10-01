/**
 * Portfolio API - Uses local storage instead of backend
 * All data stored locally in IndexedDB, no server needed
 * 
 * This API maintains compatibility with the old axios-based API
 * by wrapping responses in { data: ... } format
 */

import { localApi } from './localApi';
import { initDB } from './storage';

// Initialize IndexedDB on first import
let dbInitialized = false;
const initPromise = initDB().then(() => {
  dbInitialized = true;
}).catch(err => {
  console.error('Failed to initialize IndexedDB:', err);
});

// Helper to ensure DB is initialized before API calls
async function ensureInitialized() {
  if (!dbInitialized) {
    await initPromise;
  }
}

// Wrapper function to maintain axios-like response format
function wrapResponse(data) {
  return { data };
}

// Wrapper to ensure DB is initialized before each call
const portfolioApi = {
  // Dashboard
  async getDashboard() {
    await ensureInitialized();
    const result = await localApi.getDashboard();
    return wrapResponse(result);
  },
  
  // Accounts
  async getAccounts() {
    await ensureInitialized();
    const result = await localApi.getAccounts();
    return wrapResponse(result);
  },
  
  async createAccount(data) {
    await ensureInitialized();
    const result = await localApi.createAccount(data);
    return wrapResponse(result);
  },
  
  async getAccountMetrics(accountId) {
    await ensureInitialized();
    const result = await localApi.getAccountMetrics(accountId);
    return wrapResponse(result);
  },
  
  // Funds
  async getFunds() {
    await ensureInitialized();
    const result = await localApi.getFunds();
    return wrapResponse(result);
  },
  
  async getFund(fundId) {
    await ensureInitialized();
    const result = await localApi.getFund(fundId);
    return wrapResponse(result);
  },
  
  async createFund(data) {
    await ensureInitialized();
    const result = await localApi.createFund(data);
    return wrapResponse(result);
  },
  
  async getFundMetrics(fundId) {
    await ensureInitialized();
    const result = await localApi.getFundMetrics(fundId);
    return wrapResponse(result);
  },
  
  // Transactions
  async addTransaction(data) {
    await ensureInitialized();
    const result = await localApi.addTransaction(data);
    return wrapResponse(result);
  },
  
  async deleteTransaction(fundId, transactionId) {
    await ensureInitialized();
    const result = await localApi.deleteTransaction(fundId, transactionId);
    return wrapResponse(result);
  },
  
  // Delete fund
  async deleteFund(fundId) {
    await ensureInitialized();
    const result = await localApi.deleteFund(fundId);
    return wrapResponse(result);
  },

  // Update fund
  async updateFund(fundId, data) {
    await ensureInitialized();
    const result = await localApi.updateFund(fundId, data);
    return wrapResponse(result);
  },

  // Manual NAV (for private shares, gold, etc.)
  async setManualNav(fundId, value) {
    await ensureInitialized();
    const result = await localApi.setManualNav(fundId, value);
    return wrapResponse(result);
  },
  
  // Portfolio metrics
  async getPortfolioMetrics() {
    await ensureInitialized();
    const result = await localApi.getPortfolioMetrics();
    return wrapResponse(result);
  },
  
  // NAV/Price fetching
  async searchMutualFund(fundName) {
    await ensureInitialized();
    const result = await localApi.searchMutualFund(fundName);
    return wrapResponse(result);
  },
  
  async getMutualFundNAV(schemeCode) {
    await ensureInitialized();
    const result = await localApi.getMutualFundNAV(schemeCode);
    return wrapResponse(result);
  },
  
  async getStockPrice(symbol) {
    await ensureInitialized();
    try {
      const result = await localApi.getStockPrice(symbol);
      return wrapResponse(result);
    } catch (error) {
      return Promise.reject(error);
    }
  },
  
  async updateNAV(fundId) {
    await ensureInitialized();
    const result = await localApi.updateNAV(fundId);
    return wrapResponse(result);
  },
  
  // Calculate Interest (for PPF/FD/EPF)
  async calculateInterest(fundId) {
    await ensureInitialized();
    const result = await localApi.calculateInterest(fundId);
    return wrapResponse(result);
  },
  
  async calculateFDMaturity(fundId) {
    await ensureInitialized();
    const result = await localApi.calculateFDMaturity(fundId);
    return wrapResponse(result);
  },

  async breakFd(fundId, params) {
    await ensureInitialized();
    const result = await localApi.breakFd(fundId, params);
    return wrapResponse(result);
  },

  async getBanks() {
    await ensureInitialized();
    const result = await localApi.getBanks();
    return wrapResponse(result);
  },
  
  async getFundHoldings(fundId, schemeCode) {
    // Not implemented in local API yet
    return Promise.reject(new Error('Fund holdings not available in standalone mode'));
  },
  
  // Charts
  async getPortfolioTimeline(accountId, fundType) {
    await ensureInitialized();
    const result = await localApi.getPortfolioTimeline(accountId, fundType);
    return wrapResponse(result);
  },
  
  async getAccountAllocation() {
    await ensureInitialized();
    const result = await localApi.getAccountAllocation();
    return wrapResponse(result);
  },
  
  async getFundPerformance() {
    await ensureInitialized();
    const result = await localApi.getFundPerformance();
    return wrapResponse(result);
  },
  
  async getAssetTypeAllocation() {
    await ensureInitialized();
    return wrapResponse({ allocations: [] });
  },
  
  async getTopPerformers() {
    await ensureInitialized();
    const performances = await localApi.getFundPerformance();
    const top5 = performances.performances.slice(0, 5);
    const bottom5 = performances.performances.slice(-5).reverse();
    return wrapResponse({
      top_performers: top5,
      worst_performers: bottom5,
    });
  },
  
  // Realized Gains
  async getRealizedGains() {
    await ensureInitialized();
    const result = await localApi.getRealizedGains();
    return wrapResponse(result);
  },
};

export { portfolioApi };
export default portfolioApi;

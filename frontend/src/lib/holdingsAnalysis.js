/**
 * Holdings Analysis - Portfolio X-Ray
 * 
 * Fetches mutual fund holdings from Yahoo Finance via:
 *   AMFI scheme_code → ISIN (from mfapi.in) → Yahoo Finance symbol → topHoldings module
 * 
 * Aggregates holdings across all portfolio MFs to show:
 *   - Total company exposure (which companies you own across all MFs)
 *   - Sector allocation (aggregate sector breakdown)
 *   - Fund overlap (which companies appear in multiple funds)
 *   - Fund profile data (Morningstar rating, trailing returns, annual returns)
 */

import { CapacitorHttp, Capacitor } from '@capacitor/core';

// ============================================================
// HTTP Helpers
// ============================================================

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getNativeHttp() {
  try {
    return Capacitor.isNativePlatform() ? CapacitorHttp : null;
  } catch {
    return null;
  }
}

// --- Yahoo Finance Session (cookie + crumb) ---
// quoteSummary requires authentication; /v8/chart does not.

let _crumb = null;
let _crumbFetching = null;

/** Race a promise against a timeout (ms). Returns null on timeout. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function ensureYahooCrumb() {
  if (_crumb !== null) return _crumb;        // null = never fetched; '' = unavailable (don't re-fetch)
  if (_crumbFetching) return _crumbFetching;

  // Hard 15s cap on the entire crumb init to never block the UI
  _crumbFetching = withTimeout(_fetchCrumb(), 15000).then(r => {
    if (r === null) {
      console.error('[X-Ray] Crumb init timed out (15s)');
      _crumb = '';
    }
    return _crumb;
  });
  const result = await _crumbFetching;
  _crumbFetching = null;
  return result;
}

async function _fetchCrumb() {
  console.error('[X-Ray] Crumb: starting...');
  const http = getNativeHttp();
  console.error('[X-Ray] Crumb: native http =', !!http);

  if (http) {
    // Native path: CapacitorHttp auto-manages cookies
    // Step 1: Hit fc.yahoo.com to set session cookies (5s timeout — it may hang)
    console.error('[X-Ray] Crumb: step 1 - fc.yahoo.com...');
    try {
      await withTimeout(
        http.get({
          url: 'https://fc.yahoo.com',
          headers: { 'User-Agent': UA },
          connectTimeout: 5000,
          readTimeout: 5000,
        }),
        6000
      );
      console.error('[X-Ray] Crumb: step 1 done');
    } catch (e) {
      console.error('[X-Ray] Crumb: step 1 error (ok):', e?.message || 'unknown');
    }

    // Step 2: Get crumb (5s timeout)
    console.error('[X-Ray] Crumb: step 2 - getcrumb...');
    try {
      const crumbRes = await withTimeout(
        http.get({
          url: 'https://query2.finance.yahoo.com/v1/test/getcrumb',
          headers: { 'User-Agent': UA, 'Accept': 'text/plain' },
          connectTimeout: 5000,
          readTimeout: 5000,
        }),
        6000
      );
      console.error('[X-Ray] Crumb: step 2 status =', crumbRes?.status);
      if (crumbRes && crumbRes.status === 200 && crumbRes.data) {
        const txt = typeof crumbRes.data === 'string' ? crumbRes.data : String(crumbRes.data);
        if (txt.length < 50 && !txt.includes('{') && !txt.includes('<')) {
          _crumb = txt.trim();
          console.error('[X-Ray] Got crumb OK');
          return _crumb;
        }
      }
      console.error('[X-Ray] Crumb response not valid:', crumbRes?.status);
    } catch (e) {
      console.error('[X-Ray] Crumb fetch error:', e.message);
    }
  } else {
    // Browser path
    try {
      await withTimeout(
        fetch('https://fc.yahoo.com', { credentials: 'include', mode: 'no-cors' }).catch(() => {}),
        5000
      );
      const crumbRes = await withTimeout(
        fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
          credentials: 'include',
          headers: { 'User-Agent': UA },
        }),
        5000
      );
      if (crumbRes?.ok) {
        const txt = await crumbRes.text();
        if (txt.length < 50 && !txt.includes('{')) {
          _crumb = txt.trim();
          return _crumb;
        }
      }
    } catch { /* ignore */ }
  }

  console.error('[X-Ray] Crumb unavailable, proceeding without auth');
  _crumb = ''; // empty = proceed without crumb (will likely get 401 on quoteSummary)
  return _crumb;
}

/**
 * Fetch from Yahoo Finance with cookie+crumb authentication.
 * Required for quoteSummary, search, etc.
 */
async function yahooFetch(url) {
  const crumb = await ensureYahooCrumb();
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = crumb ? `${url}${separator}crumb=${encodeURIComponent(crumb)}` : url;

  const http = getNativeHttp();

  if (http) {
    try {
      const response = await withTimeout(
        http.get({
          url: fullUrl,
          headers: { 'Accept': '*/*', 'User-Agent': UA },
          connectTimeout: 10000,
          readTimeout: 10000,
        }),
        12000
      );
      if (!response) {
        console.error('[X-Ray] Request timed out:', url.substring(0, 100));
        return null;
      }
      if (response.status === 200 && response.data) {
        return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      }
      if (response.status === 401) {
        // Crumb expired — retry once with fresh crumb
        _crumb = null;
        const newCrumb = await ensureYahooCrumb();
        const retryUrl = newCrumb ? `${url}${separator}crumb=${encodeURIComponent(newCrumb)}` : url;
        const retry = await withTimeout(
          http.get({
            url: retryUrl,
            headers: { 'Accept': '*/*', 'User-Agent': UA },
            connectTimeout: 10000,
            readTimeout: 10000,
          }),
          12000
        );
        if (retry?.status === 200 && retry.data) {
          return typeof retry.data === 'string' ? JSON.parse(retry.data) : retry.data;
        }
        console.error('[X-Ray] Still 401 after crumb refresh:', url.substring(0, 80));
      } else if (response.status !== 200) {
        console.error(`[X-Ray] HTTP ${response.status}:`, url.substring(0, 80));
      }
    } catch (e) {
      console.error('[X-Ray] Fetch error:', e.message);
    }
  } else {
    try {
      const response = await withTimeout(
        fetch(fullUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include',
        }),
        12000
      );
      if (response?.ok) return await response.json();
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Fetch from non-Yahoo APIs (mfapi.in, etc.)
 */
async function apiFetch(url) {
  const http = getNativeHttp();

  if (http) {
    try {
      const response = await withTimeout(
        http.get({
          url,
          headers: { 'Accept': 'application/json' },
          connectTimeout: 10000,
          readTimeout: 10000,
        }),
        12000
      );
      if (response?.status === 200 && response.data) {
        return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      }
    } catch { /* fall through */ }
  }

  try {
    const response = await withTimeout(fetch(url), 10000);
    if (response?.ok) return await response.json();
  } catch { /* fall through */ }

  return null;
}

// ============================================================
// 1. ISIN Lookup from AMFI
// ============================================================

const isinCache = {};

/**
 * Get ISIN for a mutual fund scheme code from mfapi.in
 */
export async function getISIN(schemeCode) {
  if (!schemeCode) return null;
  const key = String(schemeCode);
  if (isinCache[key]) return isinCache[key];

  try {
    const data = await apiFetch(`https://api.mfapi.in/mf/${key}`);
    if (data?.meta?.isin_growth) {
      isinCache[key] = data.meta.isin_growth;
      return data.meta.isin_growth;
    }
    if (data?.meta?.isin_div_reinvestment) {
      isinCache[key] = data.meta.isin_div_reinvestment;
      return data.meta.isin_div_reinvestment;
    }
    if (!data?.meta) {
      console.error(`[X-Ray] No ISIN found for scheme ${key}`);
    }
  } catch (e) {
    console.error(`[X-Ray] ISIN fetch error for ${key}:`, e.message);
  }
  return null;
}

// ============================================================
// 2. Yahoo Finance Symbol Lookup by ISIN
// ============================================================

const yahooSymbolCache = {};

/**
 * Search Yahoo Finance by ISIN to get the Yahoo symbol (e.g., 0P0000XVJQ.BO)
 */
export async function getYahooSymbol(isin) {
  if (!isin) return null;
  if (yahooSymbolCache[isin]) return yahooSymbolCache[isin];

  const data = await yahooFetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=5&newsCount=0`
  );
  const symbol = data?.quotes?.[0]?.symbol;
  if (symbol) {
    yahooSymbolCache[isin] = symbol;
    return symbol;
  }
  return null;
}

// ============================================================
// 3. Fetch MF Holdings & Fund Data from Yahoo Finance
// ============================================================

const MODULES = 'topHoldings,fundPerformance,fundProfile,defaultKeyStatistics';

/**
 * Fetch comprehensive fund data from Yahoo Finance quoteSummary
 * @param {string} yahooSymbol - Yahoo Finance symbol (e.g., 0P0000XVJQ.BO)
 * @returns {Object|null} Parsed fund data including holdings, performance, profile
 */
export async function fetchFundData(yahooSymbol) {
  if (!yahooSymbol) return null;

  const data = await yahooFetch(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${yahooSymbol}?modules=${MODULES}`
  );
  const result = data?.quoteSummary?.result?.[0];

  if (!result) {
    // Log only on error — helps debugging without being noisy
    if (data?.quoteSummary?.error) {
      console.error(`[X-Ray] quoteSummary error for ${yahooSymbol}:`, data.quoteSummary.error.description);
    }
    return null;
  }
  return parseFundData(result);
}

function parseFundData(raw) {
  const th = raw.topHoldings || {};
  const fp = raw.fundPerformance || {};
  const prof = raw.fundProfile || {};
  const ks = raw.defaultKeyStatistics || {};

  return {
    // Holdings
    holdings: (th.holdings || []).map(h => ({
      symbol: h.symbol || null,
      name: h.holdingName || 'Unknown',
      percent: h.holdingPercent?.raw ? +(h.holdingPercent.raw * 100).toFixed(2) : 0,
      percentFmt: h.holdingPercent?.fmt || '0%',
    })),
    cashPosition: th.cashPosition?.raw ? +(th.cashPosition.raw * 100).toFixed(2) : 0,
    stockPosition: th.stockPosition?.raw ? +(th.stockPosition.raw * 100).toFixed(2) : 0,
    bondPosition: th.bondPosition?.raw ? +(th.bondPosition.raw * 100).toFixed(2) : 0,
    otherPosition: th.otherPosition?.raw ? +(th.otherPosition.raw * 100).toFixed(2) : 0,

    // Sector weightings
    sectorWeightings: (th.sectorWeightings || []).reduce((acc, sw) => {
      for (const [k, v] of Object.entries(sw)) {
        if (v.raw > 0) {
          acc.push({
            sector: formatSectorName(k),
            sectorKey: k,
            percent: +(v.raw * 100).toFixed(2),
            percentFmt: v.fmt,
          });
        }
      }
      return acc;
    }, []).sort((a, b) => b.percent - a.percent),

    // Equity holdings stats
    equityHoldings: th.equityHoldings ? {
      priceToEarnings: th.equityHoldings.priceToEarnings?.raw,
      priceToBook: th.equityHoldings.priceToBook?.raw,
      priceToSales: th.equityHoldings.priceToSales?.raw,
      priceToCashflow: th.equityHoldings.priceToCashflow?.raw,
    } : null,

    // Fund Performance
    performance: {
      ytd: fp.performanceOverview?.ytdReturnPct?.raw ? +(fp.performanceOverview.ytdReturnPct.raw * 100).toFixed(2) : null,
      fiveYrAvg: fp.performanceOverview?.fiveYrAvgReturnPct?.raw ? +(fp.performanceOverview.fiveYrAvgReturnPct.raw * 100).toFixed(2) : null,
      bestYear: fp.performanceOverview?.bestOneYrTotalReturn?.raw ? +(fp.performanceOverview.bestOneYrTotalReturn.raw * 100).toFixed(2) : null,
      worstYear: fp.performanceOverview?.worstOneYrTotalReturn?.raw ? +(fp.performanceOverview.worstOneYrTotalReturn.raw * 100).toFixed(2) : null,
      yearsUp: fp.performanceOverview?.numYearsUp?.raw,
      yearsDown: fp.performanceOverview?.numYearsDown?.raw,
    },
    trailingReturns: {
      ytd: fp.trailingReturns?.ytd?.raw ? +(fp.trailingReturns.ytd.raw * 100).toFixed(2) : null,
      oneMonth: fp.trailingReturns?.oneMonth?.raw ? +(fp.trailingReturns.oneMonth.raw * 100).toFixed(2) : null,
      threeMonth: fp.trailingReturns?.threeMonth?.raw ? +(fp.trailingReturns.threeMonth.raw * 100).toFixed(2) : null,
      oneYear: fp.trailingReturns?.oneYear?.raw ? +(fp.trailingReturns.oneYear.raw * 100).toFixed(2) : null,
      threeYear: fp.trailingReturns?.threeYear?.raw ? +(fp.trailingReturns.threeYear.raw * 100).toFixed(2) : null,
      fiveYear: fp.trailingReturns?.fiveYear?.raw ? +(fp.trailingReturns.fiveYear.raw * 100).toFixed(2) : null,
      tenYear: fp.trailingReturns?.tenYear?.raw ? +(fp.trailingReturns.tenYear.raw * 100).toFixed(2) : null,
    },
    annualReturns: (fp.annualTotalReturns?.returns || [])
      .filter(r => r.annualValue?.raw != null)
      .map(r => ({
        year: r.year,
        return: +(r.annualValue.raw * 100).toFixed(2),
      })),

    // Fund Profile
    profile: {
      family: prof.family || null,
      category: prof.categoryName || ks.category || null,
      legalType: prof.legalType || ks.legalType || null,
      expenseRatio: prof.feesExpensesInvestment?.netExpRatio?.raw
        ? +(prof.feesExpensesInvestment.netExpRatio.raw * 100).toFixed(2)
        : null,
    },

    // Key Statistics
    stats: {
      morningstarRating: ks.morningStarOverallRating?.raw || null,
      morningstarRisk: ks.morningStarRiskRating?.raw || null,
      beta: ks.beta3Year?.raw ? +ks.beta3Year.raw.toFixed(2) : null,
      inceptionDate: ks.fundInceptionDate?.fmt || null,
    },
  };
}

function formatSectorName(key) {
  const names = {
    realestate: 'Real Estate',
    consumer_cyclical: 'Consumer Cyclical',
    basic_materials: 'Basic Materials',
    consumer_defensive: 'Consumer Defensive',
    technology: 'Technology',
    communication_services: 'Communication Services',
    financial_services: 'Financial Services',
    utilities: 'Utilities',
    industrials: 'Industrials',
    energy: 'Energy',
    healthcare: 'Healthcare',
  };
  return names[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ============================================================
// 4. Full Pipeline: scheme_code → holdings
// ============================================================

/**
 * Get full fund data for a mutual fund using its AMFI scheme code
 * @param {string|number} schemeCode - AMFI scheme code
 * @returns {Object|null} Full fund data
 */
export async function getFundHoldings(schemeCode) {
  const isin = await getISIN(schemeCode);
  if (!isin) {
    console.error(`[X-Ray] No ISIN for scheme_code=${schemeCode}`);
    return null;
  }

  const yahooSymbol = await getYahooSymbol(isin);
  if (!yahooSymbol) {
    console.error(`[X-Ray] No Yahoo symbol for ISIN=${isin} (scheme=${schemeCode})`);
    return null;
  }

  return await fetchFundData(yahooSymbol);
}

/**
 * Get holdings for a stock/ETF using its symbol
 * For stocks, the "holding" is the stock itself (100%)
 * For ETFs on Yahoo, we can try topHoldings module
 */
export async function getETFHoldings(symbol) {
  let formatted = symbol;
  if (!symbol.includes('.')) {
    formatted = `${symbol}.NS`;
  }
  // Try topHoldings for ETFs
  const data = await fetchFundData(formatted);
  if (data && data.holdings.length > 0) return data;

  // Also try BSE
  if (formatted.endsWith('.NS')) {
    const bseData = await fetchFundData(formatted.replace('.NS', '.BO'));
    if (bseData && bseData.holdings.length > 0) return bseData;
  }
  return null;
}

// ============================================================
// 5. Portfolio Aggregation - X-Ray
// ============================================================

/**
 * Aggregate holdings across multiple funds to create a portfolio X-Ray
 * 
 * @param {Array} fundResults - Array of { fund, holdings, currentValue }
 *   fund: { name, type, symbol, scheme_code }
 *   holdings: result from getFundHoldings/getETFHoldings
 *   currentValue: current market value of this fund in portfolio
 * 
 * @returns {Object} Aggregated portfolio breakdown
 */
export function aggregatePortfolioHoldings(fundResults) {
  const companyMap = {}; // symbol -> { name, totalValue, totalPercent, funds: [] }
  const sectorMap = {};  // sector -> { totalPercent, totalValue }
  const overlapMap = {}; // symbol -> Set of fund names
  let totalFunds = fundResults.length;
  let fundsWithHoldings = 0;

  // IMPORTANT: totalPortfolioValue = sum of ALL fund values, not just those with holdings
  // This gives accurate portfolio-level percentages
  const totalPortfolioValue = fundResults.reduce((sum, fr) => sum + (fr.currentValue || 0), 0);
  let analyzedValue = 0;

  for (const { fund, holdings, currentValue } of fundResults) {
    // For funds WITH holdings data, process their stock-level breakdown
    if (holdings && holdings.holdings?.length) {
      fundsWithHoldings++;
      const fundValue = currentValue || 0;
      analyzedValue += fundValue;

      // Process stock holdings
      for (const h of holdings.holdings) {
        // Normalize company key: use symbol if available, standardize name otherwise
        const key = normalizeCompanyKey(h.symbol, h.name);
        const holdingValue = fundValue * (h.percent / 100);

        if (!companyMap[key]) {
          companyMap[key] = {
            symbol: h.symbol,
            name: h.name,
            totalValue: 0,
            funds: [],
          };
        }
        companyMap[key].totalValue += holdingValue;
        companyMap[key].funds.push({
          fundName: fund.name,
          percent: h.percent,
          value: holdingValue,
        });

        // Track overlap
        if (!overlapMap[key]) overlapMap[key] = new Set();
        overlapMap[key].add(fund.name);
      }

      // Process sector weightings
      for (const sw of (holdings.sectorWeightings || [])) {
        const sectorValue = fundValue * (sw.percent / 100);
        if (!sectorMap[sw.sector]) {
          sectorMap[sw.sector] = { sectorKey: sw.sectorKey, totalValue: 0 };
        }
        sectorMap[sw.sector].totalValue += sectorValue;
      }
    }

    // For direct STOCK holdings (no Yahoo holdings data), treat the stock itself as 100% holding
    if (fund.type === 'stock' && (!holdings || !holdings.holdings?.length)) {
      const key = normalizeCompanyKey(fund.symbol, fund.name);
      if (!companyMap[key]) {
        companyMap[key] = {
          symbol: fund.symbol,
          name: fund.name,
          totalValue: 0,
          funds: [],
        };
      }
      companyMap[key].totalValue += currentValue || 0;
      companyMap[key].funds.push({
        fundName: `Direct: ${fund.name}`,
        percent: 100,
        value: currentValue || 0,
      });
      if (!overlapMap[key]) overlapMap[key] = new Set();
      overlapMap[key].add(fund.name);
      analyzedValue += currentValue || 0;
    }
  }

  // Convert to sorted arrays with portfolio-level percentages
  const companies = Object.values(companyMap)
    .map(c => ({
      ...c,
      portfolioPercent: totalPortfolioValue > 0 ? +((c.totalValue / totalPortfolioValue) * 100).toFixed(2) : 0,
      fundCount: c.funds.length,
    }))
    .sort((a, b) => b.totalValue - a.totalValue);

  const sectors = Object.entries(sectorMap)
    .map(([sector, data]) => ({
      sector,
      sectorKey: data.sectorKey,
      totalValue: data.totalValue,
      portfolioPercent: totalPortfolioValue > 0 ? +((data.totalValue / totalPortfolioValue) * 100).toFixed(2) : 0,
    }))
    .sort((a, b) => b.totalValue - a.totalValue);

  // Overlap: companies appearing in 2+ funds
  const overlapping = Object.entries(overlapMap)
    .filter(([, funds]) => funds.size >= 2)
    .map(([key, funds]) => ({
      key,
      symbol: companyMap[key]?.symbol,
      name: companyMap[key]?.name || key,
      fundCount: funds.size,
      funds: Array.from(funds),
      totalValue: companyMap[key]?.totalValue || 0,
      portfolioPercent: companyMap[key]?.portfolioPercent || 0,
    }))
    .sort((a, b) => b.fundCount - a.fundCount || b.totalValue - a.totalValue);

  return {
    companies,
    sectors,
    overlapping,
    summary: {
      totalPortfolioValue,
      analyzedValue,
      coveragePercent: totalPortfolioValue > 0 ? +((analyzedValue / totalPortfolioValue) * 100).toFixed(1) : 0,
      totalFunds,
      fundsWithHoldings,
      totalCompanies: companies.length,
      totalSectors: sectors.length,
      overlappingCompanies: overlapping.length,
    },
  };
}

/**
 * Normalize company key for deduplication.
 * Yahoo returns symbols like "HDFCBANK.NS" or "RELIANCE.BO". 
 * Normalize to just the base symbol for matching.
 */
function normalizeCompanyKey(symbol, name) {
  if (symbol) {
    // Remove exchange suffix for dedup (HDFCBANK.NS and HDFCBANK.BO are the same company)
    return symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
  }
  // Normalize name
  return (name || 'Unknown').trim().toUpperCase();
}

// ============================================================
// 6. Cache Helpers
// ============================================================

const CACHE_KEY = 'portfolio_xray_cache';

export function saveXRayCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data,
    }));
  } catch (e) { /* ignore */ }
}

export function loadXRayCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

export function clearXRayCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (e) { /* ignore */ }
}

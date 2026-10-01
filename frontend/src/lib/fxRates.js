/**
 * FX rate fetching with localStorage caching.
 *
 * Used by ESOP/RSU input to convert foreign-currency grants (typically USD for
 * Indian employees of US-listed companies) to INR. We hit Yahoo Finance for the
 * latest spot rate (e.g. USDINR=X), keep a 6-hour stale-while-revalidate cache
 * in localStorage, and gracefully fall back to a hard-coded rough rate if the
 * network is unavailable so the user is never blocked.
 *
 * Pattern intentionally mirrors `getStockPrice` in localApi.js — Capacitor first,
 * then XHR, then fetch — so it works in the native iOS bundle too.
 */

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED', 'AUD', 'CAD', 'JPY', 'CHF'];

// Last-resort fallback if every network path fails. Better to estimate than
// produce a "NaN" in the UI. These are intentionally conservative as of late 2025.
const FALLBACK_RATES_TO_INR = {
  INR: 1,
  USD: 84.0,
  EUR: 92.0,
  GBP: 108.0,
  SGD: 63.0,
  AED: 22.9,
  AUD: 55.0,
  CAD: 60.0,
  JPY: 0.55,
  CHF: 96.0,
};

const CACHE_KEY = 'fx_rates_cache_v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) { /* storage full — non-fatal */ }
}

async function yahooFetch(url) {
  // Native iOS — bypasses CORS
  try {
    const { CapacitorHttp, Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url,
        headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' },
      });
      if (response.status === 200 && response.data) {
        return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      }
    }
  } catch (e) { /* fall through */ }

  // Web fallback
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (response.ok) return await response.json();
  } catch (e) { /* fall through */ }

  return null;
}

/**
 * Fetch 1 unit of `fromCurrency` priced in `toCurrency` (INR by default).
 * Returns `{ rate, source, fetchedAt }`.
 */
export async function getFxRate(fromCurrency, toCurrency = 'INR') {
  const from = (fromCurrency || 'INR').toUpperCase();
  const to = (toCurrency || 'INR').toUpperCase();

  if (from === to) {
    return { rate: 1, source: 'identity', fetchedAt: Date.now() };
  }

  const cache = loadCache();
  const cacheKey = `${from}_${to}`;
  const cached = cache[cacheKey];
  const now = Date.now();

  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return { ...cached, source: 'cache' };
  }

  // Yahoo uses XXXYYY=X format (e.g. USDINR=X for 1 USD in INR).
  const yahooSymbol = `${from}${to}=X`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`;
  const data = await yahooFetch(url);

  let rate = null;
  let source = 'fallback';
  if (data?.chart?.result?.[0]?.meta) {
    const meta = data.chart.result[0].meta;
    rate = meta.regularMarketPrice ?? meta.previousClose ?? null;
    if (rate) source = 'yahoo';
  }

  // Fallback: hard-coded last-known-good rates so the UI never breaks
  if (!rate) {
    if (to === 'INR' && FALLBACK_RATES_TO_INR[from] != null) {
      rate = FALLBACK_RATES_TO_INR[from];
    } else if (from === 'INR' && FALLBACK_RATES_TO_INR[to] != null) {
      rate = 1 / FALLBACK_RATES_TO_INR[to];
    } else if (FALLBACK_RATES_TO_INR[from] != null && FALLBACK_RATES_TO_INR[to] != null) {
      // Cross via INR
      rate = FALLBACK_RATES_TO_INR[from] / FALLBACK_RATES_TO_INR[to];
    }
    // If we're using fallback, still cache (with shorter TTL would be nicer, but
    // keep it simple — refresh on next page reload).
    if (cached?.rate) {
      // Prefer last cached value over fallback rates if we have one
      return { ...cached, source: 'stale' };
    }
  }

  if (rate) {
    const entry = { rate, source, fetchedAt: now };
    cache[cacheKey] = entry;
    saveCache(cache);
    return entry;
  }

  return null;
}

/**
 * Convert an amount and round to 2 decimal places. Returns null if the FX
 * fetch failed entirely (which is rare given the fallback table above).
 */
export async function convertToInr(amount, fromCurrency) {
  if (!Number.isFinite(amount)) return null;
  if (!fromCurrency || fromCurrency === 'INR') return Math.round(amount * 100) / 100;

  const result = await getFxRate(fromCurrency, 'INR');
  if (!result?.rate) return null;
  return Math.round(amount * result.rate * 100) / 100;
}

/**
 * Get a human-readable label for an FX rate, used in tooltips.
 * Example: "1 USD ≈ ₹84.12 (Yahoo, 2h ago)"
 */
export function formatFxRate(rateEntry, fromCurrency, toCurrency = 'INR') {
  if (!rateEntry?.rate) return '';
  const ageMs = Date.now() - (rateEntry.fetchedAt || Date.now());
  const ageMin = Math.round(ageMs / 60000);
  const age = ageMin < 1 ? 'just now'
    : ageMin < 60 ? `${ageMin}m ago`
    : `${Math.round(ageMin / 60)}h ago`;
  const sourceLabel = rateEntry.source === 'yahoo' ? 'Yahoo'
    : rateEntry.source === 'cache' ? 'cached'
    : rateEntry.source === 'stale' ? 'cached'
    : 'estimated';
  const symbol = toCurrency === 'INR' ? '₹' : (toCurrency + ' ');
  return `1 ${fromCurrency} ≈ ${symbol}${rateEntry.rate.toFixed(2)} (${sourceLabel}, ${age})`;
}

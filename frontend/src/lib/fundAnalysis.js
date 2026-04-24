/**
 * Fund Analysis - Data fetching and computation layer
 * Fetches fundamentals from Yahoo Finance quoteSummary, computes technical indicators,
 * risk metrics, and rolling returns from historical price/NAV data.
 */

// ============================================================
// HTTP Helper (Capacitor-aware, same pattern as benchmark.js)
// ============================================================

async function yahooFetch(url) {
  // Try CapacitorHttp first (for native iOS app - bypasses CORS)
  try {
    const { CapacitorHttp, Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.get({
        url,
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (response.status === 200 && response.data) {
        return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      }
    }
  } catch (e) { /* fall through */ }

  // Fallback: fetch
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors'
    });
    if (response.ok) return await response.json();
  } catch (e) { /* fall through */ }

  return null;
}

// ============================================================
// 1. YAHOO FINANCE QUOTE SUMMARY (Stocks/ETFs only)
// ============================================================

const QUOTE_SUMMARY_MODULES = [
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'recommendationTrend',
  'assetProfile'
].join(',');

/**
 * Fetch stock fundamentals from Yahoo Finance quoteSummary
 * @param {string} symbol - Stock symbol (e.g. "HDFCBANK" or "HDFCBANK.NS")
 * @returns {Object|null} Parsed fundamental data
 */
export async function fetchStockFundamentals(symbol) {
  let formatted = symbol;
  if (!symbol.includes('.')) {
    formatted = `${symbol}.NS`;
  }

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${formatted}?modules=${QUOTE_SUMMARY_MODULES}`;
  const data = await yahooFetch(url);

  if (!data || !data.quoteSummary?.result?.[0]) {
    // Try BSE
    if (formatted.endsWith('.NS')) {
      const bseUrl = url.replace('.NS', '.BO');
      const bseData = await yahooFetch(bseUrl);
      if (bseData?.quoteSummary?.result?.[0]) {
        return parseQuoteSummary(bseData.quoteSummary.result[0], symbol);
      }
    }
    return null;
  }

  return parseQuoteSummary(data.quoteSummary.result[0], symbol);
}

function safeNum(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'object' && obj.raw !== undefined) return obj.raw;
  if (typeof obj === 'object' && obj.fmt !== undefined) return parseFloat(obj.fmt);
  return parseFloat(obj) || null;
}

function parseQuoteSummary(result, symbol) {
  const sd = result.summaryDetail || {};
  const ks = result.defaultKeyStatistics || {};
  const fd = result.financialData || {};
  const rt = result.recommendationTrend?.trend || [];
  const ap = result.assetProfile || {};

  // Analyst recommendation trend - most recent period
  const latestTrend = rt.length > 0 ? rt[0] : {};

  return {
    symbol,
    // Valuation
    trailingPE: safeNum(sd.trailingPE),
    forwardPE: safeNum(ks.forwardPE),
    priceToBook: safeNum(ks.priceToBook),
    pegRatio: safeNum(ks.pegRatio),
    enterpriseToEbitda: safeNum(ks.enterpriseToEbitda),
    enterpriseToRevenue: safeNum(ks.enterpriseToRevenue),
    marketCap: safeNum(sd.marketCap),

    // Price Levels
    fiftyTwoWeekHigh: safeNum(sd.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: safeNum(sd.fiftyTwoWeekLow),
    fiftyDayAverage: safeNum(sd.fiftyDayAverage),
    twoHundredDayAverage: safeNum(sd.twoHundredDayAverage),

    // Profitability
    returnOnEquity: safeNum(fd.returnOnEquity),
    returnOnAssets: safeNum(fd.returnOnAssets),
    grossMargins: safeNum(fd.grossMargins),
    operatingMargins: safeNum(fd.operatingMargins),
    profitMargins: safeNum(fd.profitMargins),

    // Growth
    revenueGrowth: safeNum(fd.revenueGrowth),
    earningsGrowth: safeNum(fd.earningsGrowth),
    earningsQuarterlyGrowth: safeNum(ks.earningsQuarterlyGrowth),

    // Leverage / Health
    debtToEquity: safeNum(fd.debtToEquity),
    currentRatio: safeNum(fd.currentRatio),
    quickRatio: safeNum(fd.quickRatio),
    totalDebt: safeNum(fd.totalDebt),
    totalCash: safeNum(fd.totalCash),
    freeCashflow: safeNum(fd.freeCashflow),

    // Risk
    beta: safeNum(sd.beta) || safeNum(ks.beta3Year),

    // Dividends
    dividendYield: safeNum(sd.dividendYield),
    payoutRatio: safeNum(sd.payoutRatio),

    // Analyst consensus
    targetMeanPrice: safeNum(fd.targetMeanPrice),
    targetHighPrice: safeNum(fd.targetHighPrice),
    targetLowPrice: safeNum(fd.targetLowPrice),
    targetMedianPrice: safeNum(fd.targetMedianPrice),
    recommendationKey: fd.recommendationKey || null, // "buy", "hold", "sell"
    recommendationMean: safeNum(fd.recommendationMean), // 1-5 scale
    numberOfAnalystOpinions: safeNum(fd.numberOfAnalystOpinions),
    currentPrice: safeNum(fd.currentPrice),

    // Analyst trend (most recent period)
    analystStrongBuy: latestTrend.strongBuy || 0,
    analystBuy: latestTrend.buy || 0,
    analystHold: latestTrend.hold || 0,
    analystSell: latestTrend.sell || 0,
    analystStrongSell: latestTrend.strongSell || 0,

    // Identity
    sector: ap.sector || null,
    industry: ap.industry || null,
    longBusinessSummary: ap.longBusinessSummary || null,
  };
}

// ============================================================
// 2. HISTORICAL PRICE DATA (for technicals)
// ============================================================

/**
 * Fetch 1-year daily historical prices from Yahoo Finance
 * @param {string} symbol - Stock symbol
 * @returns {Array<{date:string, open:number, high:number, low:number, close:number, volume:number}>}
 */
export async function fetchHistoricalPrices(symbol) {
  let formatted = symbol;
  if (!symbol.includes('.')) formatted = `${symbol}.NS`;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${formatted}?interval=1d&range=2y`;
  const data = await yahooFetch(url);

  if (!data?.chart?.result?.[0]) return [];

  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};

  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split('T')[0],
    open: quote.open?.[i] ?? null,
    high: quote.high?.[i] ?? null,
    low: quote.low?.[i] ?? null,
    close: quote.close?.[i] ?? null,
    volume: quote.volume?.[i] ?? null,
  })).filter(d => d.close !== null);
}

/**
 * Fetch full historical NAV from MFAPI (mutual funds)
 * @param {string} schemeCode
 * @returns {Array<{date:string, nav:number}>} sorted oldest→newest
 */
export async function fetchMFHistoricalNAV(schemeCode) {
  try {
    let data;
    // Try CapacitorHttp first
    try {
      const { CapacitorHttp, Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const response = await CapacitorHttp.get({ url: `https://api.mfapi.in/mf/${schemeCode}` });
        if (response.status === 200) {
          data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        }
      }
    } catch (e) { /* fall through */ }

    if (!data) {
      const response = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
      data = await response.json();
    }

    if (!data?.data) return { history: [], meta: null };

    const meta = data.meta || null;
    // MFAPI returns newest first, reverse for chronological
    const history = data.data
      .map(d => {
        // MFAPI date is DD-MM-YYYY
        const parts = d.date.split('-');
        const isoDate = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : d.date;
        return { date: isoDate, close: parseFloat(d.nav) };
      })
      .filter(d => !isNaN(d.close))
      .reverse(); // oldest first

    return { history, meta };
  } catch (e) {
    return { history: [], meta: null };
  }
}

// ============================================================
// 3. TECHNICAL INDICATORS (computed locally)
// ============================================================

/**
 * Compute a Simple Moving Average
 */
function computeSMA(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result.push(sum / period);
  }
  return result;
}

/**
 * Compute an Exponential Moving Average
 */
function computeEMA(closes, period) {
  const k = 2 / (period + 1);
  const result = [];
  let ema = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      // Seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      ema = sum / period;
    } else {
      ema = closes[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

/**
 * Compute RSI (Relative Strength Index)
 */
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return { values: [], latest: null };

  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const rsiValues = [];
  for (let i = 0; i < period; i++) rsiValues.push(null);

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsiValues.push(100 - (100 / (1 + rs)));

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsI = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rsI)));
  }

  return { values: rsiValues, latest: rsiValues[rsiValues.length - 1] };
}

/**
 * Compute MACD (12, 26, 9)
 */
function computeMACD(closes) {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      macdLine.push(ema12[i] - ema26[i]);
    } else {
      macdLine.push(null);
    }
  }

  // Signal line = 9-period EMA of MACD line
  const nonNull = macdLine.filter(v => v !== null);
  const signalArr = computeEMA(nonNull, 9);

  // Align back
  let idx = 0;
  const signalLine = [];
  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
      histogram.push(null);
    } else {
      const sig = signalArr[idx] ?? null;
      signalLine.push(sig);
      histogram.push(sig !== null ? macdLine[i] - sig : null);
      idx++;
    }
  }

  const latestMACD = macdLine.filter(v => v !== null);
  const latestSignal = signalLine.filter(v => v !== null);
  const latestHist = histogram.filter(v => v !== null);

  return {
    macdLine: latestMACD[latestMACD.length - 1] ?? null,
    signalLine: latestSignal[latestSignal.length - 1] ?? null,
    histogram: latestHist[latestHist.length - 1] ?? null,
    bullish: latestMACD.length > 0 && latestSignal.length > 0
      ? latestMACD[latestMACD.length - 1] > latestSignal[latestSignal.length - 1]
      : null,
  };
}

/**
 * Compute Bollinger Bands (20, 2)
 */
function computeBollingerBands(closes, period = 20, stdDev = 2) {
  const sma = computeSMA(closes, period);
  const latest = sma[sma.length - 1];
  if (latest === null) return { upper: null, middle: null, lower: null, percentB: null };

  let variance = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    variance += Math.pow(closes[i] - latest, 2);
  }
  variance /= period;
  const sd = Math.sqrt(variance);

  const upper = latest + stdDev * sd;
  const lower = latest - stdDev * sd;
  const currentPrice = closes[closes.length - 1];
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;

  return { upper, middle: latest, lower, percentB };
}

/**
 * Compute ADX (Average Directional Index)
 */
function computeADX(highs, lows, closes, period = 14) {
  if (closes.length < period * 2 + 1) return null;

  const trueRanges = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);

    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Wilder's smoothing
  const smooth = (arr, p) => {
    const result = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += arr[i];
    result.push(sum);
    for (let i = p; i < arr.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / p + arr[i]);
    }
    return result;
  };

  const smoothTR = smooth(trueRanges, period);
  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);

  const dx = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) { dx.push(0); continue; }
    const pdi = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const mdi = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : Math.abs(pdi - mdi) / sum * 100);
  }

  if (dx.length < period) return null;
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

/**
 * Compute all technical indicators for a price series
 * @param {Array} priceData - Array of {date, close, high?, low?, volume?}
 * @returns {Object} Technical indicator values
 */
export function computeTechnicalIndicators(priceData) {
  if (!priceData || priceData.length < 30) {
    return { insufficient: true };
  }

  const closes = priceData.map(d => d.close);
  const highs = priceData.map(d => d.high || d.close);
  const lows = priceData.map(d => d.low || d.close);
  const currentPrice = closes[closes.length - 1];

  // Moving Averages
  const sma50 = computeSMA(closes, 50);
  const sma200 = computeSMA(closes, 200);
  const sma20 = computeSMA(closes, 20);
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  const latestSMA50 = sma50[sma50.length - 1];
  const latestSMA200 = sma200[sma200.length - 1];
  const latestSMA20 = sma20[sma20.length - 1];
  const prevSMA50 = sma50.length > 2 ? sma50[sma50.length - 2] : null;
  const prevSMA200 = sma200.length > 2 ? sma200[sma200.length - 2] : null;

  // Golden/Death Cross detection
  let crossSignal = null;
  if (latestSMA50 && latestSMA200 && prevSMA50 && prevSMA200) {
    if (prevSMA50 <= prevSMA200 && latestSMA50 > latestSMA200) crossSignal = 'golden_cross';
    else if (prevSMA50 >= prevSMA200 && latestSMA50 < latestSMA200) crossSignal = 'death_cross';
  }

  // RSI
  const rsi = computeRSI(closes, 14);

  // MACD
  const macd = computeMACD(closes);

  // Bollinger Bands
  const bollinger = computeBollingerBands(closes, 20, 2);

  // ADX
  const adx = computeADX(highs, lows, closes, 14);

  // 52-week high/low from data
  const oneYearPrices = closes.slice(-252);
  const fiftyTwoWeekHigh = Math.max(...oneYearPrices);
  const fiftyTwoWeekLow = Math.min(...oneYearPrices);

  // Position in 52W range
  const rangePosition = fiftyTwoWeekHigh !== fiftyTwoWeekLow
    ? (currentPrice - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow)
    : 0.5;

  // Price vs SMA deviation
  const deviationFromSMA50 = latestSMA50 ? ((currentPrice - latestSMA50) / latestSMA50) * 100 : null;
  const deviationFromSMA200 = latestSMA200 ? ((currentPrice - latestSMA200) / latestSMA200) * 100 : null;

  // Trend direction from SMA slope
  let trendDirection = 'sideways';
  if (latestSMA50 && prevSMA50) {
    const smaSlope = (latestSMA50 - prevSMA50) / prevSMA50 * 100;
    if (smaSlope > 0.05) trendDirection = 'uptrend';
    else if (smaSlope < -0.05) trendDirection = 'downtrend';
  }

  // Trend strength from ADX
  let trendStrength = 'none';
  if (adx !== null) {
    if (adx > 40) trendStrength = 'strong';
    else if (adx > 25) trendStrength = 'moderate';
    else if (adx > 20) trendStrength = 'weak';
    else trendStrength = 'none';
  }

  // Momentum composite
  let momentum = 'neutral';
  const rsiVal = rsi.latest;
  if (rsiVal !== null && macd.bullish !== null) {
    if (rsiVal > 60 && macd.bullish) momentum = 'bullish';
    else if (rsiVal > 70) momentum = 'overbought';
    else if (rsiVal < 40 && !macd.bullish) momentum = 'bearish';
    else if (rsiVal < 30) momentum = 'oversold';
  }

  return {
    currentPrice,
    // Moving Averages
    sma20: latestSMA20,
    sma50: latestSMA50,
    sma200: latestSMA200,
    priceAboveSMA50: latestSMA50 ? currentPrice > latestSMA50 : null,
    priceAboveSMA200: latestSMA200 ? currentPrice > latestSMA200 : null,
    deviationFromSMA50,
    deviationFromSMA200,
    crossSignal,

    // RSI
    rsi: rsiVal !== null ? Math.round(rsiVal * 100) / 100 : null,
    rsiSignal: rsiVal > 70 ? 'overbought' : rsiVal < 30 ? 'oversold' : 'neutral',

    // MACD
    macd: macd.macdLine,
    macdSignal: macd.signalLine,
    macdHistogram: macd.histogram,
    macdBullish: macd.bullish,

    // Bollinger Bands
    bollingerUpper: bollinger.upper,
    bollingerMiddle: bollinger.middle,
    bollingerLower: bollinger.lower,
    bollingerPercentB: bollinger.percentB,

    // ADX
    adx: adx !== null ? Math.round(adx * 100) / 100 : null,

    // 52-week range
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    rangePosition: Math.round(rangePosition * 100),
    distanceFrom52WH: fiftyTwoWeekHigh ? Math.round(((currentPrice - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 10000) / 100 : null,
    distanceFrom52WL: fiftyTwoWeekLow ? Math.round(((currentPrice - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 10000) / 100 : null,

    // Composite signals
    trendDirection,
    trendStrength,
    momentum,
    insufficient: false,
  };
}

// ============================================================
// 4. RISK METRICS
// ============================================================

/**
 * Compute risk metrics from daily returns
 * @param {Array} priceData - Array of {date, close}
 * @param {Array} benchmarkData - Array of {date, close} for benchmark (optional)
 * @param {number} riskFreeRate - Annualized risk-free rate (default 6.5% for India)
 */
export function computeRiskMetrics(priceData, benchmarkData = null, riskFreeRate = 0.065) {
  if (!priceData || priceData.length < 30) {
    return { insufficient: true };
  }

  const closes = priceData.map(d => d.close);

  // Daily returns
  const dailyReturns = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }

  // Annualized return
  const totalReturn = (closes[closes.length - 1] - closes[0]) / closes[0];
  const tradingDays = closes.length;
  const annualizedReturn = Math.pow(1 + totalReturn, 252 / tradingDays) - 1;

  // Volatility (annualized)
  const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (dailyReturns.length - 1);
  const dailyVol = Math.sqrt(variance);
  const annualizedVolatility = dailyVol * Math.sqrt(252);

  // Sharpe Ratio
  const dailyRiskFree = Math.pow(1 + riskFreeRate, 1 / 252) - 1;
  const excessReturns = dailyReturns.map(r => r - dailyRiskFree);
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const sharpeRatio = dailyVol > 0 ? (meanExcess / dailyVol) * Math.sqrt(252) : 0;

  // Sortino Ratio (downside deviation only)
  const downsideReturns = excessReturns.filter(r => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);
  const sortinoRatio = downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : 0;

  // Max Drawdown
  let peak = closes[0];
  let maxDrawdown = 0;
  let maxDrawdownStart = 0, maxDrawdownEnd = 0;
  let currentDrawdownStart = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) {
      peak = closes[i];
      currentDrawdownStart = i;
    }
    const drawdown = (peak - closes[i]) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownStart = currentDrawdownStart;
      maxDrawdownEnd = i;
    }
  }

  // VaR (95%)
  const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
  const varIndex = Math.floor(dailyReturns.length * 0.05);
  const var95 = sortedReturns[varIndex] || 0;

  // Beta & Alpha (if benchmark provided)
  let beta = null;
  let alpha = null;
  let rSquared = null;

  if (benchmarkData && benchmarkData.length > 30) {
    const benchCloses = benchmarkData.map(d => d.close);
    const benchReturns = [];
    for (let i = 1; i < benchCloses.length; i++) {
      benchReturns.push((benchCloses[i] - benchCloses[i - 1]) / benchCloses[i - 1]);
    }

    // Align lengths
    const minLen = Math.min(dailyReturns.length, benchReturns.length);
    const fundRet = dailyReturns.slice(-minLen);
    const benchRet = benchReturns.slice(-minLen);

    const meanFund = fundRet.reduce((a, b) => a + b, 0) / minLen;
    const meanBench = benchRet.reduce((a, b) => a + b, 0) / minLen;

    let covariance = 0, benchVariance = 0, fundVariance = 0;
    for (let i = 0; i < minLen; i++) {
      covariance += (fundRet[i] - meanFund) * (benchRet[i] - meanBench);
      benchVariance += Math.pow(benchRet[i] - meanBench, 2);
      fundVariance += Math.pow(fundRet[i] - meanFund, 2);
    }
    covariance /= minLen;
    benchVariance /= minLen;
    fundVariance /= minLen;

    beta = benchVariance > 0 ? covariance / benchVariance : null;

    if (beta !== null) {
      const benchAnnualized = Math.pow(1 + (benchCloses[benchCloses.length - 1] - benchCloses[0]) / benchCloses[0], 252 / benchCloses.length) - 1;
      alpha = annualizedReturn - (riskFreeRate + beta * (benchAnnualized - riskFreeRate));
    }

    // R-squared
    const denominator = Math.sqrt(fundVariance * benchVariance);
    const correlation = denominator > 0 ? covariance / denominator : 0;
    rSquared = correlation * correlation;
  }

  return {
    annualizedReturn: Math.round(annualizedReturn * 10000) / 100,
    annualizedVolatility: Math.round(annualizedVolatility * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    sortinoRatio: Math.round(sortinoRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    var95: Math.round(var95 * 10000) / 100,
    beta: beta !== null ? Math.round(beta * 100) / 100 : null,
    alpha: alpha !== null ? Math.round(alpha * 10000) / 100 : null,
    rSquared: rSquared !== null ? Math.round(rSquared * 10000) / 100 : null,
    insufficient: false,
  };
}

// ============================================================
// 5. ROLLING RETURNS
// ============================================================

/**
 * Compute rolling returns for various periods
 * @param {Array} priceData - Array of {date, close}
 * @returns {Object} Rolling returns
 */
export function computeRollingReturns(priceData) {
  if (!priceData || priceData.length < 5) return {};

  const closes = priceData.map(d => d.close);
  const currentPrice = closes[closes.length - 1];

  const computeReturn = (days) => {
    if (closes.length < days) return null;
    const oldPrice = closes[closes.length - days];
    if (!oldPrice || oldPrice === 0) return null;
    return Math.round(((currentPrice - oldPrice) / oldPrice) * 10000) / 100;
  };

  const computeCAGR = (days) => {
    if (closes.length < days) return null;
    const oldPrice = closes[closes.length - days];
    if (!oldPrice || oldPrice === 0) return null;
    const years = days / 252;
    if (years <= 0) return null;
    return Math.round((Math.pow(currentPrice / oldPrice, 1 / years) - 1) * 10000) / 100;
  };

  // Consistency: % of rolling 1Y periods with positive returns
  let positiveRolling = 0;
  let totalRolling = 0;
  if (closes.length > 252) {
    for (let i = 252; i < closes.length; i++) {
      totalRolling++;
      if (closes[i] > closes[i - 252]) positiveRolling++;
    }
  }

  return {
    return1W: computeReturn(5),
    return1M: computeReturn(21),
    return3M: computeReturn(63),
    return6M: computeReturn(126),
    return1Y: computeReturn(252),
    cagr1Y: computeCAGR(252),
    cagr3Y: closes.length >= 756 ? computeCAGR(756) : null,
    cagr5Y: closes.length >= 1260 ? computeCAGR(1260) : null,
    consistency: totalRolling > 0 ? Math.round((positiveRolling / totalRolling) * 100) : null,
  };
}

// ============================================================
// 6. DISCOVER - Curated stock/MF lists for buy recommendations
// ============================================================

// Popular Indian stocks by category - well-known liquid picks
const DISCOVER_STOCKS = {
  'Large Cap - Blue Chips': [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
    'HINDUNILVR', 'BHARTIARTL', 'ITC', 'SBIN', 'BAJFINANCE',
    'LT', 'KOTAKBANK', 'HCLTECH', 'MARUTI', 'TITAN',
  ],
  'IT & Tech': [
    'INFY', 'TCS', 'HCLTECH', 'WIPRO', 'TECHM',
    'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'CYIENT',
  ],
  'Banking & Finance': [
    'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'SBIN', 'AXISBANK',
    'BAJFINANCE', 'BAJAJFINSV', 'CHOLAFIN', 'HDFCLIFE', 'SBILIFE',
  ],
  'Pharma & Healthcare': [
    'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'APOLLOHOSP',
    'MAXHEALTH', 'MANKIND', 'LAURUSLABS', 'BIOCON', 'AUROPHARMA',
  ],
  'Auto & Manufacturing': [
    'MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'HEROMOTOCO',
    'EICHERMOT', 'TVSMOTOR', 'ASHOKLEY', 'MOTHERSON', 'BHARATFORG',
  ],
  'Consumer & FMCG': [
    'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR',
    'MARICO', 'GODREJCP', 'TATACONSUM', 'COLPAL', 'VBL',
  ],
  'Energy & Infra': [
    'RELIANCE', 'NTPC', 'POWERGRID', 'ADANIENT', 'ADANIGREEN',
    'LT', 'ULTRACEMCO', 'GRASIM', 'ADANIPORTS', 'TATAPOWER',
  ],
  'Defence & Aerospace': [
    'HAL', 'BEL', 'BDL', 'SOLARINDS', 'COCHINSHIP',
    'MAZAGON', 'GRSE', 'DATAPATTNS', 'PARAS', 'IDEAFORGE',
  ],
  'Railways & PSU': [
    'IRFC', 'IRCTC', 'RVNL', 'RAILTEL', 'TITAGARH',
    'RITES', 'NHPC', 'SJVN', 'RECLTD', 'PFC',
  ],
  'Real Estate & Construction': [
    'DLF', 'GODREJPROP', 'OBEROIRLTY', 'PRESTIGE', 'BRIGADE',
    'PHOENIXLTD', 'LODHA', 'SOBHA', 'SUNTECK', 'MAHLIFE',
  ],
  'Metals & Mining': [
    'TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'COALINDIA',
    'NMDC', 'NATIONALUM', 'SAIL', 'JINDALSTEL', 'HINDZINC',
  ],
  'Telecom & Media': [
    'BHARTIARTL', 'IDEA', 'TATACOMM', 'HFCL', 'STLTECH',
    'ROUTE', 'NAZARA', 'ZEEL', 'NETWORK18', 'PVRINOX',
  ],
  'Chemicals & Specialty': [
    'PIDILITIND', 'SRF', 'ATUL', 'DEEPAKNTR', 'NAVINFLUOR',
    'CLEAN', 'AARTI', 'FLUOROCHEM', 'ALKYLAMINE', 'GALAXYSURF',
  ],
  'Green Energy & EV': [
    'ADANIGREEN', 'TATAPOWER', 'NHPC', 'SJVN', 'IREDA',
    'SUZLON', 'BOROSIL', 'WAAREEENER', 'TATAMOTORS', 'OLECTRA',
  ],
  'Insurance': [
    'HDFCLIFE', 'SBILIFE', 'ICICIPRULI', 'MAXHEALTH', 'STARHEALTH',
    'NIACL', 'GICRE', 'LICI', 'POLICYBZR', 'ABSLAMC',
  ],
};

// Popular MF scheme codes (Direct-Growth plans)
const DISCOVER_MF = {
  'Large Cap': [
    { code: '120503', name: 'Mirae Asset Large Cap Fund - Direct Growth' },
    { code: '120505', name: 'Axis Bluechip Fund - Direct Growth' },
    { code: '100526', name: 'SBI Bluechip Fund - Direct Growth' },
    { code: '118834', name: 'Canara Robeco Bluechip Equity Fund - Direct Growth' },
    { code: '120587', name: 'ICICI Prudential Bluechip Fund - Direct Growth' },
    { code: '100027', name: 'Aditya Birla Sun Life Frontline Equity Fund - Direct Growth' },
    { code: '101252', name: 'Nippon India Large Cap Fund - Direct Growth' },
    { code: '100819', name: 'HDFC Top 100 Fund - Direct Growth' },
    { code: '119364', name: 'Edelweiss Large Cap Fund - Direct Growth' },
    { code: '105934', name: 'Kotak Bluechip Fund - Direct Growth' },
  ],
  'Flexi Cap': [
    { code: '122639', name: 'Parag Parikh Flexi Cap Fund - Direct Growth' },
    { code: '100822', name: 'HDFC Flexi Cap Fund - Direct Growth' },
    { code: '119598', name: 'UTI Flexi Cap Fund - Direct Growth' },
    { code: '105833', name: 'Kotak Flexicap Fund - Direct Growth' },
    { code: '125354', name: 'Quant Flexi Cap Fund - Direct Growth' },
    { code: '100119', name: 'SBI Flexicap Fund - Direct Growth' },
    { code: '120578', name: 'PGIM India Flexi Cap Fund - Direct Growth' },
    { code: '100520', name: 'Franklin India Flexi Cap Fund - Direct Growth' },
    { code: '118989', name: 'Canara Robeco Flexi Cap Fund - Direct Growth' },
    { code: '120465', name: 'Motilal Oswal Flexi Cap Fund - Direct Growth' },
  ],
  'Mid Cap': [
    { code: '101542', name: 'HDFC Mid Cap Opportunities Fund - Direct Growth' },
    { code: '101617', name: 'Kotak Emerging Equity Fund - Direct Growth' },
    { code: '119307', name: 'Axis Midcap Fund - Direct Growth' },
    { code: '100474', name: 'SBI Magnum Midcap Fund - Direct Growth' },
    { code: '119775', name: 'Mirae Asset Midcap Fund - Direct Growth' },
    { code: '125355', name: 'Quant Mid Cap Fund - Direct Growth' },
    { code: '100524', name: 'DSP Midcap Fund - Direct Growth' },
    { code: '118741', name: 'Edelweiss Mid Cap Fund - Direct Growth' },
    { code: '120586', name: 'PGIM India Midcap Opportunities Fund - Direct Growth' },
    { code: '101491', name: 'Nippon India Growth Fund - Direct Growth' },
  ],
  'Small Cap': [
    { code: '125494', name: 'Quant Small Cap Fund - Direct Growth' },
    { code: '125497', name: 'Nippon India Small Cap Fund - Direct Growth' },
    { code: '120828', name: 'SBI Small Cap Fund - Direct Growth' },
    { code: '130503', name: 'Axis Small Cap Fund - Direct Growth' },
    { code: '125307', name: 'HDFC Small Cap Fund - Direct Growth' },
    { code: '125492', name: 'Kotak Small Cap Fund - Direct Growth' },
    { code: '120176', name: 'DSP Small Cap Fund - Direct Growth' },
    { code: '118774', name: 'Canara Robeco Small Cap Fund - Direct Growth' },
    { code: '125356', name: 'Tata Small Cap Fund - Direct Growth' },
    { code: '127042', name: 'ICICI Prudential Smallcap Fund - Direct Growth' },
  ],
  'Index / Passive': [
    { code: '120716', name: 'UTI Nifty 50 Index Fund - Direct Growth' },
    { code: '120684', name: 'HDFC Index Fund Nifty 50 - Direct Growth' },
    { code: '119597', name: 'UTI Nifty Next 50 Index Fund - Direct Growth' },
    { code: '150923', name: 'Motilal Oswal Nifty Midcap 150 Index Fund - Direct Growth' },
    { code: '120682', name: 'HDFC Index Fund Sensex - Direct Growth' },
    { code: '120688', name: 'ICICI Prudential Nifty 50 Index Fund - Direct Growth' },
    { code: '148749', name: 'Motilal Oswal Nifty 500 Index Fund - Direct Growth' },
    { code: '147622', name: 'Navi Nifty 50 Index Fund - Direct Growth' },
    { code: '149870', name: 'Bandhan Nifty 50 Index Fund - Direct Growth' },
    { code: '145552', name: 'Motilal Oswal Nifty Smallcap 250 Index Fund - Direct Growth' },
  ],
  'ELSS (Tax Saving)': [
    { code: '119770', name: 'Mirae Asset Tax Saver Fund - Direct Growth' },
    { code: '120503', name: 'Axis Long Term Equity Fund - Direct Growth' },
    { code: '100516', name: 'SBI Long Term Equity Fund - Direct Growth' },
    { code: '105758', name: 'Kotak Tax Saver Fund - Direct Growth' },
    { code: '125354', name: 'Quant Tax Plan - Direct Growth' },
    { code: '120200', name: 'DSP Tax Saver Fund - Direct Growth' },
    { code: '120587', name: 'ICICI Prudential Long Term Equity Fund - Direct Growth' },
    { code: '118835', name: 'Canara Robeco Equity Tax Saver Fund - Direct Growth' },
    { code: '100188', name: 'HDFC TaxSaver Fund - Direct Growth' },
    { code: '100470', name: 'Nippon India Tax Saver Fund - Direct Growth' },
  ],
  'Debt / Liquid': [
    { code: '119551', name: 'HDFC Liquid Fund - Direct Growth' },
    { code: '119789', name: 'SBI Liquid Fund - Direct Growth' },
    { code: '120837', name: 'ICICI Prudential Liquid Fund - Direct Growth' },
    { code: '119390', name: 'Axis Liquid Fund - Direct Growth' },
    { code: '119565', name: 'HDFC Short Term Debt Fund - Direct Growth' },
    { code: '119020', name: 'ICICI Prudential Short Term Fund - Direct Growth' },
    { code: '119787', name: 'SBI Magnum Medium Duration Fund - Direct Growth' },
    { code: '119021', name: 'ICICI Prudential Corporate Bond Fund - Direct Growth' },
    { code: '100470', name: 'Kotak Corporate Bond Fund - Direct Growth' },
    { code: '119553', name: 'HDFC Corporate Bond Fund - Direct Growth' },
  ],
  'Hybrid / Balanced': [
    { code: '119568', name: 'HDFC Balanced Advantage Fund - Direct Growth' },
    { code: '120242', name: 'ICICI Prudential Balanced Advantage Fund - Direct Growth' },
    { code: '119608', name: 'SBI Equity Hybrid Fund - Direct Growth' },
    { code: '100527', name: 'Kotak Equity Hybrid Fund - Direct Growth' },
    { code: '119569', name: 'HDFC Hybrid Equity Fund - Direct Growth' },
    { code: '118662', name: 'Canara Robeco Equity Hybrid Fund - Direct Growth' },
    { code: '120175', name: 'DSP Equity & Bond Fund - Direct Growth' },
    { code: '119401', name: 'Axis Equity Hybrid Fund - Direct Growth' },
    { code: '120457', name: 'Motilal Oswal Equity Hybrid Fund - Direct Growth' },
    { code: '125354', name: 'Quant Multi Asset Fund - Direct Growth' },
  ],
  'Sectoral - IT & Tech': [
    { code: '120594', name: 'ICICI Prudential Technology Fund - Direct Growth' },
    { code: '120465', name: 'Tata Digital India Fund - Direct Growth' },
    { code: '100526', name: 'SBI Technology Opportunities Fund - Direct Growth' },
    { code: '100027', name: 'Aditya Birla Sun Life Digital India Fund - Direct Growth' },
    { code: '120503', name: 'Franklin India Technology Fund - Direct Growth' },
  ],
  'Sectoral - Pharma & Health': [
    { code: '120591', name: 'ICICI Prudential Pharma Healthcare & Diagnostics Fund - Direct Growth' },
    { code: '120465', name: 'Tata India Pharma & Healthcare Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India Pharma Fund - Direct Growth' },
    { code: '100027', name: 'Aditya Birla Sun Life Pharma & Healthcare Fund - Direct Growth' },
    { code: '120503', name: 'SBI Healthcare Opportunities Fund - Direct Growth' },
  ],
  'Sectoral - Banking & Finance': [
    { code: '120594', name: 'ICICI Prudential Banking & Financial Services Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India Banking & Financial Services Fund - Direct Growth' },
    { code: '120465', name: 'Tata Banking & Financial Services Fund - Direct Growth' },
    { code: '100027', name: 'Aditya Birla Sun Life Banking & Financial Services Fund - Direct Growth' },
    { code: '120503', name: 'SBI Banking & Financial Services Fund - Direct Growth' },
  ],
  'Sectoral - Infra & Energy': [
    { code: '120594', name: 'ICICI Prudential Infrastructure Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India Power & Infra Fund - Direct Growth' },
    { code: '120465', name: 'Tata Infrastructure Fund - Direct Growth' },
    { code: '100027', name: 'DSP India T.I.G.E.R Fund - Direct Growth' },
    { code: '119568', name: 'HDFC Infrastructure Fund - Direct Growth' },
    { code: '100822', name: 'Franklin Build India Fund - Direct Growth' },
  ],
  'Sectoral - Consumption': [
    { code: '120594', name: 'ICICI Prudential India Consumption Fund - Direct Growth' },
    { code: '120465', name: 'Tata India Consumer Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India Consumption Fund - Direct Growth' },
    { code: '100027', name: 'Aditya Birla Sun Life India GenNext Fund - Direct Growth' },
    { code: '120503', name: 'SBI Consumption Opportunities Fund - Direct Growth' },
  ],
  'Thematic - Defence & PSU': [
    { code: '147622', name: 'HDFC Defence Fund - Direct Growth' },
    { code: '149870', name: 'Motilal Oswal Nifty India Defence Index Fund - Direct Growth' },
    { code: '120242', name: 'ICICI Prudential PSU Equity Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India PSU Equity Fund - Direct Growth' },
    { code: '120465', name: 'Invesco India PSU Equity Fund - Direct Growth' },
  ],
  'Thematic - Manufacturing & MNC': [
    { code: '120594', name: 'ICICI Prudential Manufacturing Fund - Direct Growth' },
    { code: '100027', name: 'Aditya Birla Sun Life Manufacturing Equity Fund - Direct Growth' },
    { code: '120503', name: 'SBI Contra Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India Multi Cap Fund - Direct Growth' },
    { code: '101617', name: 'Kotak Manufacture in India Fund - Direct Growth' },
  ],
  'Gold & Commodities': [
    { code: '119788', name: 'SBI Gold Fund - Direct Growth' },
    { code: '120684', name: 'HDFC Gold Fund - Direct Growth' },
    { code: '120594', name: 'ICICI Prudential Regular Gold Savings Fund - Direct Growth' },
    { code: '119390', name: 'Axis Gold Fund - Direct Growth' },
    { code: '100469', name: 'Nippon India Gold Savings Fund - Direct Growth' },
    { code: '100027', name: 'Invesco India Gold Fund - Direct Growth' },
  ],
  'International': [
    { code: '122639', name: 'Parag Parikh Flexi Cap Fund - Direct Growth' },
    { code: '120465', name: 'Motilal Oswal Nasdaq 100 FOF - Direct Growth' },
    { code: '120503', name: 'Franklin India Feeder - US Opportunities Fund - Direct Growth' },
    { code: '120684', name: 'HDFC Developed World Indexes FOF - Direct Growth' },
    { code: '120242', name: 'ICICI Prudential US Bluechip Equity Fund - Direct Growth' },
    { code: '119608', name: 'DSP US Flexible Equity Fund - Direct Growth' },
  ],
};

/**
 * Get available discover categories
 */
export function getDiscoverCategories() {
  return {
    stocks: Object.keys(DISCOVER_STOCKS),
    mutualFunds: Object.keys(DISCOVER_MF),
  };
}

/**
 * Get items for a discover category
 * @param {string} type - 'stock' or 'mf'
 * @param {string} category - Category name
 */
export function getDiscoverItems(type, category) {
  if (type === 'stock') {
    const symbols = DISCOVER_STOCKS[category] || [];
    return [...new Set(symbols)].map(s => ({ symbol: s, name: s, type: 'stock' }));
  } else {
    const mfs = DISCOVER_MF[category] || [];
    return mfs.map(m => ({ schemeCode: m.code, name: m.name, type: 'mutual_fund' }));
  }
}

/**
 * Analyze a discover item (stock or MF) — same pipeline as portfolio analysis but without personal score
 */
export async function analyzeDiscoverItem(item) {
  let priceData = [];
  let fundamentals = null;
  let meta = null;

  if (item.type === 'mutual_fund' && item.schemeCode) {
    const mfData = await fetchMFHistoricalNAV(item.schemeCode);
    priceData = mfData.history || [];
    meta = mfData.meta;
    if (priceData.length > 500) priceData = priceData.slice(-500);
  } else if (item.symbol) {
    priceData = await fetchHistoricalPrices(item.symbol);
    fundamentals = await fetchStockFundamentals(item.symbol);
  }

  const technicals = computeTechnicalIndicators(priceData);
  const riskMetrics = computeRiskMetrics(priceData);
  const rollingReturns = computeRollingReturns(priceData);

  return { fundamentals, technicals, riskMetrics, rollingReturns, meta, priceData };
}

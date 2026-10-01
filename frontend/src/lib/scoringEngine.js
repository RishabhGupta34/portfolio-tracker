/**
 * Scoring Engine - Computes composite scores and generates Buy/Hold/Sell recommendations
 * for both stocks and mutual funds based on technical, fundamental, risk, and momentum signals.
 *
 * Notes on scoring philosophy:
 *  - The composite score reflects fund/stock QUALITY, not how well it has performed for the
 *    current user. Personal-position factors (XIRR earned so far, holding length, weight in
 *    your portfolio) live in `scorePersonal` and are surfaced as a separate "Your position"
 *    panel — they are NOT folded into the recommendation.
 *  - Sharpe ratio, max drawdown and volatility are evaluated ONCE inside `scoreRisk` to
 *    avoid double-counting them across dimensions.
 *  - Mutual-fund thresholds for risk and 1Y return are CATEGORY-AWARE: small-cap funds get
 *    different vol / Sharpe / drawdown bands than large-cap or debt funds.
 */

// ============================================================
// CATEGORY DETECTION & PER-CATEGORY THRESHOLDS
// ============================================================

/**
 * Map a fund's profile category (from Yahoo X-Ray or AMFI meta) to one of our internal
 * category buckets. Buckets are coarse on purpose — a few thresholds per bucket is enough.
 */
export function getFundCategory(meta, xrayData) {
  const raw = (xrayData?.profile?.category || meta?.scheme_category || '').toString().toLowerCase();
  if (!raw) return 'default';

  // Debt
  if (/(debt|liquid|gilt|bond|duration|income|overnight|money market|credit risk|banking and psu|psu|floater|dynamic bond)/.test(raw)) {
    return 'debt';
  }
  // Hybrid
  if (/(hybrid|balanced|arbitrage|multi asset|asset allocator|conservative|aggressive)/.test(raw)) {
    return 'hybrid';
  }
  // Index / ETF
  if (/(index|etf|exchange traded|nifty|sensex)/.test(raw)) {
    return 'index';
  }
  // Sectoral / thematic / international — usually higher variance
  if (/(sector|thematic|technology|pharma|banking|infrastructure|consumption|international|global|us equity|nasdaq)/.test(raw)) {
    return 'sector';
  }
  // Equity sub-types
  if (/small/.test(raw)) return 'small_cap';
  if (/mid/.test(raw)) return 'mid_cap';
  if (/(large|bluechip|focused)/.test(raw)) return 'large_cap';
  if (/(flexi|multi cap|multicap|elss|tax saver|value|contra|dividend yield)/.test(raw)) return 'flexi_cap';

  return 'default';
}

/**
 * Per-category thresholds. Each set defines bands for the metrics that get scored
 * differently by category. For metrics not listed here, the generic bands inside the
 * scorers continue to apply.
 *
 * Fields:
 *   sharpeBands:    [excellent, good, average, belowAvg]   // Sharpe ratio cutoffs
 *   ddBands:        [low, moderate, high]                  // max-drawdown % cutoffs
 *   volBands:       [low, moderate, high]                  // annualized volatility % cutoffs
 *   ret1YBands:     [strong, good, average, lowPositive]   // 1Y return % cutoffs
 *   ret3YBands:     [strong, good, average]                // 3Y CAGR % cutoffs
 */
const CATEGORY_THRESHOLDS = {
  small_cap: {
    sharpeBands: [1.2, 0.8, 0.4, 0],
    ddBands: [15, 25, 40],
    volBands: [18, 25, 35],
    ret1YBands: [35, 22, 12, 0],
    ret3YBands: [22, 15, 8],
  },
  mid_cap: {
    sharpeBands: [1.3, 0.9, 0.5, 0],
    ddBands: [12, 20, 32],
    volBands: [15, 22, 30],
    ret1YBands: [30, 18, 10, 0],
    ret3YBands: [20, 13, 7],
  },
  large_cap: {
    sharpeBands: [1.5, 1.0, 0.5, 0],
    ddBands: [10, 18, 28],
    volBands: [12, 18, 25],
    ret1YBands: [22, 14, 8, 0],
    ret3YBands: [16, 11, 6],
  },
  flexi_cap: {
    sharpeBands: [1.4, 0.95, 0.5, 0],
    ddBands: [11, 19, 30],
    volBands: [13, 19, 27],
    ret1YBands: [25, 15, 9, 0],
    ret3YBands: [18, 12, 7],
  },
  sector: {
    sharpeBands: [1.3, 0.85, 0.4, 0],
    ddBands: [18, 30, 45],
    volBands: [22, 30, 40],
    ret1YBands: [30, 18, 8, 0],
    ret3YBands: [22, 14, 7],
  },
  index: {
    sharpeBands: [1.2, 0.9, 0.5, 0],
    ddBands: [10, 18, 28],
    volBands: [12, 18, 25],
    ret1YBands: [20, 13, 7, 0],
    ret3YBands: [15, 10, 5],
  },
  hybrid: {
    sharpeBands: [1.4, 1.0, 0.6, 0],
    ddBands: [8, 14, 22],
    volBands: [8, 13, 18],
    ret1YBands: [15, 10, 6, 0],
    ret3YBands: [12, 8, 5],
  },
  debt: {
    sharpeBands: [2.0, 1.4, 0.8, 0],
    ddBands: [2, 5, 10],
    volBands: [2, 5, 9],
    ret1YBands: [9, 7, 5, 0],
    ret3YBands: [8, 6.5, 5],
  },
  default: {
    sharpeBands: [1.5, 1.0, 0.5, 0],
    ddBands: [10, 18, 28],
    volBands: [12, 20, 30],
    ret1YBands: [25, 15, 8, 0],
    ret3YBands: [18, 12, 6],
  },
};

function bandedScore(value, [a, b, c, d], [pa, pb, pc, pd, pe]) {
  if (value > a) return pa;
  if (value > b) return pb;
  if (value > c) return pc;
  if (value > d) return pd;
  return pe;
}

// ============================================================
// INDIVIDUAL DIMENSION SCORERS (each returns 0-100)
// ============================================================

/**
 * Score fundamentals (stocks only — from Yahoo quoteSummary)
 * For mutual funds, returns a quality score derived from rolling returns & risk instead.
 */
export function scoreFundamentals(fundamentals, isMutualFund = false, extraData = {}) {
  if (isMutualFund || !fundamentals) {
    return scoreMFQuality(extraData);
  }

  let score = 50;
  const details = {};

  // PE Ratio: Lower is better, but too low might mean trouble
  if (fundamentals.trailingPE !== null) {
    if (fundamentals.trailingPE < 0) { score -= 10; details.pe = 'Negative earnings'; }
    else if (fundamentals.trailingPE < 10) { score += 10; details.pe = 'Very cheap'; }
    else if (fundamentals.trailingPE < 20) { score += 5; details.pe = 'Reasonably valued'; }
    else if (fundamentals.trailingPE < 35) { score -= 0; details.pe = 'Fair'; }
    else if (fundamentals.trailingPE < 60) { score -= 5; details.pe = 'Expensive'; }
    else { score -= 10; details.pe = 'Very expensive'; }
  }

  // PEG Ratio: <1 undervalued relative to growth
  if (fundamentals.pegRatio !== null) {
    if (fundamentals.pegRatio < 0.5) { score += 8; details.peg = 'Deeply undervalued vs growth'; }
    else if (fundamentals.pegRatio < 1) { score += 5; details.peg = 'Undervalued vs growth'; }
    else if (fundamentals.pegRatio < 2) { score += 0; details.peg = 'Fair PEG'; }
    else { score -= 5; details.peg = 'Overvalued vs growth'; }
  }

  // Price to Book
  if (fundamentals.priceToBook !== null) {
    if (fundamentals.priceToBook < 1) { score += 5; details.pb = 'Below book value'; }
    else if (fundamentals.priceToBook < 3) { score += 2; details.pb = 'Reasonable P/B'; }
    else if (fundamentals.priceToBook < 8) { score -= 0; details.pb = 'Premium P/B'; }
    else { score -= 5; details.pb = 'Very high P/B'; }
  }

  // ROE
  if (fundamentals.returnOnEquity !== null) {
    const roe = fundamentals.returnOnEquity * 100;
    if (roe > 25) { score += 8; details.roe = `Excellent ROE (${roe.toFixed(1)}%)`; }
    else if (roe > 15) { score += 5; details.roe = `Good ROE (${roe.toFixed(1)}%)`; }
    else if (roe > 8) { score += 0; details.roe = `Average ROE (${roe.toFixed(1)}%)`; }
    else { score -= 5; details.roe = `Low ROE (${roe.toFixed(1)}%)`; }
  }

  // Debt to Equity
  if (fundamentals.debtToEquity !== null) {
    if (fundamentals.debtToEquity < 20) { score += 5; details.debt = 'Very low debt'; }
    else if (fundamentals.debtToEquity < 50) { score += 3; details.debt = 'Low debt'; }
    else if (fundamentals.debtToEquity < 100) { score += 0; details.debt = 'Moderate debt'; }
    else if (fundamentals.debtToEquity < 200) { score -= 5; details.debt = 'High debt'; }
    else { score -= 10; details.debt = 'Very high debt'; }
  }

  // Revenue Growth
  if (fundamentals.revenueGrowth !== null) {
    const rg = fundamentals.revenueGrowth * 100;
    if (rg > 20) { score += 5; details.revGrowth = `Strong growth (${rg.toFixed(1)}%)`; }
    else if (rg > 5) { score += 3; details.revGrowth = `Growing (${rg.toFixed(1)}%)`; }
    else if (rg > 0) { score += 0; details.revGrowth = `Flat (${rg.toFixed(1)}%)`; }
    else { score -= 5; details.revGrowth = `Declining (${rg.toFixed(1)}%)`; }
  }

  // Earnings Growth
  if (fundamentals.earningsGrowth !== null) {
    const eg = fundamentals.earningsGrowth * 100;
    if (eg > 20) { score += 5; details.earningsGrowth = `Strong (${eg.toFixed(1)}%)`; }
    else if (eg > 5) { score += 3; details.earningsGrowth = `Positive (${eg.toFixed(1)}%)`; }
    else if (eg > 0) { score += 0; details.earningsGrowth = `Flat (${eg.toFixed(1)}%)`; }
    else { score -= 5; details.earningsGrowth = `Declining (${eg.toFixed(1)}%)`; }
  }

  // Analyst Target upside
  if (fundamentals.targetMeanPrice && fundamentals.currentPrice) {
    const upside = ((fundamentals.targetMeanPrice - fundamentals.currentPrice) / fundamentals.currentPrice) * 100;
    if (upside > 30) { score += 8; details.targetUpside = `${upside.toFixed(1)}% upside`; }
    else if (upside > 15) { score += 5; details.targetUpside = `${upside.toFixed(1)}% upside`; }
    else if (upside > 0) { score += 2; details.targetUpside = `${upside.toFixed(1)}% upside`; }
    else { score -= 5; details.targetUpside = `${upside.toFixed(1)}% downside`; }
  }

  // Analyst Recommendation
  if (fundamentals.recommendationMean !== null) {
    if (fundamentals.recommendationMean <= 1.5) { score += 8; details.analyst = 'Strong Buy consensus'; }
    else if (fundamentals.recommendationMean <= 2.5) { score += 5; details.analyst = 'Buy consensus'; }
    else if (fundamentals.recommendationMean <= 3.5) { score += 0; details.analyst = 'Hold consensus'; }
    else if (fundamentals.recommendationMean <= 4.5) { score -= 5; details.analyst = 'Sell consensus'; }
    else { score -= 8; details.analyst = 'Strong Sell consensus'; }
  }

  // Profit Margins
  if (fundamentals.profitMargins !== null) {
    const pm = fundamentals.profitMargins * 100;
    if (pm > 20) { score += 3; details.margins = `Healthy margins (${pm.toFixed(1)}%)`; }
    else if (pm > 10) { score += 1; details.margins = `Decent margins (${pm.toFixed(1)}%)`; }
    else if (pm > 0) { score -= 0; details.margins = `Thin margins (${pm.toFixed(1)}%)`; }
    else { score -= 5; details.margins = `Negative margins (${pm.toFixed(1)}%)`; }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: score >= 70 ? 'Strong' : score >= 55 ? 'Good' : score >= 40 ? 'Fair' : 'Weak',
  };
}

/**
 * Score "Fund Quality" for mutual funds. Focuses on signals that are NOT already covered
 * by `scoreRisk` (which owns Sharpe / drawdown / volatility). Pulls from rolling returns,
 * AMFI meta, and Yahoo X-Ray data (Morningstar rating, expense ratio, trailing returns,
 * holdings valuations, year up/down ratio, beta).
 */
function scoreMFQuality(extraData = {}) {
  const { rollingReturns, riskMetrics: _riskMetrics, meta, xrayData } = extraData;

  if (!rollingReturns && !xrayData) {
    return { score: 50, details: {}, label: 'No data' };
  }

  const category = getFundCategory(meta, xrayData);
  const cat = CATEGORY_THRESHOLDS[category];

  let score = 50;
  const details = { _category: category };

  if (xrayData) {
    // Morningstar Rating — gold-standard fund quality signal
    if (xrayData.stats?.morningstarRating != null) {
      const stars = xrayData.stats.morningstarRating;
      if (stars >= 5) { score += 12; details.morningstar = `★★★★★ Morningstar`; }
      else if (stars >= 4) { score += 8; details.morningstar = `★★★★ Morningstar`; }
      else if (stars >= 3) { score += 3; details.morningstar = `★★★ Morningstar`; }
      else if (stars >= 2) { score -= 3; details.morningstar = `★★ Morningstar`; }
      else { score -= 8; details.morningstar = `★ Morningstar`; }
    }

    // Expense Ratio — directly eats returns
    if (xrayData.profile?.expenseRatio != null) {
      const er = xrayData.profile.expenseRatio;
      if (er < 0.5) { score += 6; details.expense = `Very low expense (${er}%)`; }
      else if (er < 1.0) { score += 3; details.expense = `Low expense (${er}%)`; }
      else if (er < 1.5) { score += 0; details.expense = `Moderate expense (${er}%)`; }
      else if (er < 2.0) { score -= 3; details.expense = `High expense (${er}%)`; }
      else { score -= 6; details.expense = `Very high expense (${er}%)`; }
    }

    // Fund-level Equity PE
    if (xrayData.equityHoldings?.priceToEarnings != null) {
      const pe = xrayData.equityHoldings.priceToEarnings;
      if (pe > 0 && pe < 15) { score += 4; details.fundPE = `Cheap holdings (PE ${pe.toFixed(1)})`; }
      else if (pe < 22) { score += 2; details.fundPE = `Fair holdings (PE ${pe.toFixed(1)})`; }
      else if (pe < 35) { score -= 0; details.fundPE = `Moderate PE (${pe.toFixed(1)})`; }
      else { score -= 3; details.fundPE = `Expensive holdings (PE ${pe.toFixed(1)})`; }
    }

    // Fund-level Price to Book
    if (xrayData.equityHoldings?.priceToBook != null) {
      const pb = xrayData.equityHoldings.priceToBook;
      if (pb < 2) { score += 2; details.fundPB = `Value-oriented (PB ${pb.toFixed(1)})`; }
      else if (pb < 4) { score += 0; details.fundPB = `Moderate PB (${pb.toFixed(1)})`; }
      else { score -= 2; details.fundPB = `Growth premium (PB ${pb.toFixed(1)})`; }
    }

    // Yahoo trailing returns (category-aware) — preferred over our computed 1Y
    const tr = xrayData.trailingReturns;
    if (tr) {
      if (tr.oneYear != null) {
        const points = bandedScore(tr.oneYear, cat.ret1YBands, [10, 6, 3, 0, -6]);
        score += points;
        details.trRet1Y = `1Y: ${tr.oneYear > 0 ? '+' : ''}${tr.oneYear}% (${category})`;
      }
      if (tr.threeYear != null) {
        const points = bandedScore(tr.threeYear, cat.ret3YBands.concat([0]), [5, 3, 0, -4, -4]);
        score += points;
        details.trRet3Y = `3Y CAGR: ${tr.threeYear > 0 ? '+' : ''}${tr.threeYear}%`;
      }
      if (tr.fiveYear != null) {
        if (tr.fiveYear > cat.ret3YBands[0] - 2) { score += 4; details.trRet5Y = `Strong 5Y CAGR (+${tr.fiveYear}%)`; }
        else if (tr.fiveYear > cat.ret3YBands[1] - 2) { score += 2; details.trRet5Y = `Good 5Y CAGR (+${tr.fiveYear}%)`; }
        else if (tr.fiveYear > cat.ret3YBands[2] - 2) { score += 0; details.trRet5Y = `Average 5Y CAGR (+${tr.fiveYear}%)`; }
        else { score -= 3; details.trRet5Y = `Weak 5Y CAGR (${tr.fiveYear}%)`; }
      }
    }

    // Years Up / Years Down — long-run consistency
    if (xrayData.performance?.yearsUp != null && xrayData.performance?.yearsDown != null) {
      const totalYears = xrayData.performance.yearsUp + xrayData.performance.yearsDown;
      if (totalYears > 0) {
        const upRatio = xrayData.performance.yearsUp / totalYears;
        if (upRatio > 0.85) { score += 4; details.upDown = `${xrayData.performance.yearsUp}/${totalYears} years positive`; }
        else if (upRatio > 0.7) { score += 2; details.upDown = `${xrayData.performance.yearsUp}/${totalYears} years positive`; }
        else if (upRatio < 0.5) { score -= 3; details.upDown = `${xrayData.performance.yearsUp}/${totalYears} years positive`; }
      }
    }

    // Beta (3Y) — aggression indicator (separate from absolute risk in scoreRisk)
    if (xrayData.stats?.beta != null) {
      const beta = xrayData.stats.beta;
      if (beta < 0.7) { score += 3; details.beta = `Defensive (β ${beta})`; }
      else if (beta < 1.1) { score += 1; details.beta = `Market-aligned (β ${beta})`; }
      else if (beta > 1.3) { score -= 3; details.beta = `Aggressive (β ${beta})`; }
    }

    if (xrayData.profile?.category) {
      details.category = xrayData.profile.category;
    }
  }

  // Computed signals (NAV-based) — used as fallback or supplement when X-Ray missing
  if (!xrayData?.trailingReturns?.oneYear && rollingReturns?.return1Y != null) {
    const points = bandedScore(rollingReturns.return1Y, cat.ret1YBands, [12, 8, 4, 0, -8]);
    score += points;
    details.ret1Y = `1Y return: ${rollingReturns.return1Y > 0 ? '+' : ''}${rollingReturns.return1Y}% (${category})`;
  }

  // 3M short-term quality signal (kept generic — short windows are noisy regardless of category)
  if (rollingReturns?.return3M != null) {
    if (rollingReturns.return3M > 10) { score += 5; details.ret3M = `Strong 3M (+${rollingReturns.return3M}%)`; }
    else if (rollingReturns.return3M > 3) { score += 2; details.ret3M = `Positive 3M (+${rollingReturns.return3M}%)`; }
    else if (rollingReturns.return3M < -5) { score -= 5; details.ret3M = `Weak 3M (${rollingReturns.return3M}%)`; }
  }

  // Rolling-return consistency — distinct from drawdown, so safe to keep here
  if (rollingReturns?.consistency != null) {
    if (rollingReturns.consistency > 85) { score += 8; details.consistency = `Very consistent (${rollingReturns.consistency}% positive)`; }
    else if (rollingReturns.consistency > 70) { score += 5; details.consistency = `Consistent (${rollingReturns.consistency}% positive)`; }
    else if (rollingReturns.consistency > 50) { score += 0; details.consistency = `Average (${rollingReturns.consistency}% positive)`; }
    else { score -= 5; details.consistency = `Inconsistent (${rollingReturns.consistency}% positive)`; }
  }

  // Sharpe / drawdown intentionally NOT scored here — they belong to scoreRisk only.

  if (!details.category && meta?.scheme_category) {
    details.category = meta.scheme_category;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: score >= 70 ? 'Strong' : score >= 55 ? 'Good' : score >= 40 ? 'Fair' : 'Weak',
  };
}

/**
 * Score technical indicators
 */
export function scoreTechnicals(technicals) {
  if (!technicals || technicals.insufficient) {
    return { score: 50, details: {}, label: 'Insufficient data' };
  }

  let score = 50;
  const details = {};

  if (technicals.rsi !== null) {
    if (technicals.rsi >= 70) { score -= 10; details.rsi = `Overbought (${technicals.rsi})`; }
    else if (technicals.rsi >= 60) { score += 3; details.rsi = `Bullish (${technicals.rsi})`; }
    else if (technicals.rsi >= 40) { score += 5; details.rsi = `Neutral (${technicals.rsi})`; }
    else if (technicals.rsi >= 30) { score += 3; details.rsi = `Bearish (${technicals.rsi})`; }
    else { score += 10; details.rsi = `Oversold - potential buy (${technicals.rsi})`; }
  }

  if (technicals.macdBullish !== null) {
    if (technicals.macdBullish) { score += 8; details.macd = 'Bullish crossover'; }
    else { score -= 5; details.macd = 'Bearish crossover'; }
  }

  if (technicals.priceAboveSMA200 !== null) {
    if (technicals.priceAboveSMA200) { score += 8; details.sma200 = 'Above 200 SMA (uptrend)'; }
    else { score -= 8; details.sma200 = 'Below 200 SMA (downtrend)'; }
  }

  if (technicals.priceAboveSMA50 !== null) {
    if (technicals.priceAboveSMA50) { score += 5; details.sma50 = 'Above 50 SMA'; }
    else { score -= 5; details.sma50 = 'Below 50 SMA'; }
  }

  if (technicals.crossSignal === 'golden_cross') { score += 10; details.cross = 'Golden Cross detected!'; }
  else if (technicals.crossSignal === 'death_cross') { score -= 10; details.cross = 'Death Cross detected!'; }

  if (technicals.bollingerPercentB !== null) {
    if (technicals.bollingerPercentB > 1) { score -= 5; details.bollinger = 'Above upper band'; }
    else if (technicals.bollingerPercentB > 0.8) { score -= 2; details.bollinger = 'Near upper band'; }
    else if (technicals.bollingerPercentB < 0) { score += 5; details.bollinger = 'Below lower band - potential buy'; }
    else if (technicals.bollingerPercentB < 0.2) { score += 2; details.bollinger = 'Near lower band'; }
    else { details.bollinger = 'Mid-range'; }
  }

  if (technicals.adx !== null) {
    if (technicals.adx > 40) { details.adx = `Very strong trend (${technicals.adx})`; }
    else if (technicals.adx > 25) { details.adx = `Trending (${technicals.adx})`; }
    else { details.adx = `No clear trend (${technicals.adx})`; }
  }

  if (technicals.rangePosition !== null && technicals.rangePosition !== undefined) {
    if (technicals.rangePosition > 90) { score -= 3; details.range = `Near 52W high (${technicals.rangePosition}%)`; }
    else if (technicals.rangePosition > 70) { score += 0; details.range = `Upper range (${technicals.rangePosition}%)`; }
    else if (technicals.rangePosition > 30) { score += 3; details.range = `Mid range (${technicals.rangePosition}%)`; }
    else if (technicals.rangePosition > 10) { score += 5; details.range = `Lower range (${technicals.rangePosition}%)`; }
    else { score += 3; details.range = `Near 52W low (${technicals.rangePosition}%)`; }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: technicals.momentum || 'neutral',
  };
}

/**
 * Score risk metrics. For mutual funds this is the SOLE home for Sharpe/drawdown/volatility,
 * and uses category-aware thresholds when meta/xrayData are provided.
 */
export function scoreRisk(risk, extraData = {}) {
  if (!risk || risk.insufficient) {
    return { score: 50, details: {}, label: 'Insufficient data' };
  }

  const isMutualFund = !!(extraData.meta || extraData.xrayData);
  const cat = isMutualFund
    ? CATEGORY_THRESHOLDS[getFundCategory(extraData.meta, extraData.xrayData)]
    : CATEGORY_THRESHOLDS.default;

  let score = 50;
  const details = {};
  if (isMutualFund) details._category = getFundCategory(extraData.meta, extraData.xrayData);

  // Sharpe Ratio — category-aware
  if (risk.sharpeRatio !== null) {
    const points = bandedScore(risk.sharpeRatio, cat.sharpeBands, [15, 10, 3, -5, -10]);
    score += points;
    details.sharpe = `Sharpe ${risk.sharpeRatio} (${isMutualFund ? details._category : 'default'} band)`;
  }

  // Sortino Ratio — universal, no category override needed
  if (risk.sortinoRatio !== null) {
    if (risk.sortinoRatio > 2) { score += 5; details.sortino = `Excellent (${risk.sortinoRatio})`; }
    else if (risk.sortinoRatio > 1) { score += 3; details.sortino = `Good (${risk.sortinoRatio})`; }
    else if (risk.sortinoRatio > 0) { score += 0; details.sortino = `Average (${risk.sortinoRatio})`; }
    else { score -= 5; details.sortino = `Poor (${risk.sortinoRatio})`; }
  }

  // Volatility — category-aware. Lower is better.
  if (risk.annualizedVolatility !== null) {
    const v = risk.annualizedVolatility;
    if (v < cat.volBands[0]) { score += 8; details.volatility = `Low for category (${v}%)`; }
    else if (v < cat.volBands[1]) { score += 3; details.volatility = `Moderate for category (${v}%)`; }
    else if (v < cat.volBands[2]) { score -= 3; details.volatility = `High for category (${v}%)`; }
    else { score -= 8; details.volatility = `Very high for category (${v}%)`; }
  }

  // Max Drawdown — category-aware. Lower is better.
  if (risk.maxDrawdown !== null) {
    const dd = risk.maxDrawdown;
    if (dd < cat.ddBands[0]) { score += 8; details.maxDD = `Mild drawdown (${dd}%)`; }
    else if (dd < cat.ddBands[1]) { score += 3; details.maxDD = `Moderate drawdown (${dd}%)`; }
    else if (dd < cat.ddBands[2]) { score -= 3; details.maxDD = `Significant drawdown (${dd}%)`; }
    else { score -= 8; details.maxDD = `Severe drawdown (${dd}%)`; }
  }

  // Ulcer Index — depth × duration of drawdowns (mf-screener metric).
  // Roughly half of max-DD bands; we add it as a *bonus* / *penalty* on top of
  // max-DD because the two capture different things (instantaneous worst vs
  // sustained pain). Magnitude is intentionally smaller than maxDD.
  if (risk.ulcerIndex !== null && risk.ulcerIndex !== undefined) {
    const ui = risk.ulcerIndex;
    const half0 = cat.ddBands[0] / 2;
    const half1 = cat.ddBands[1] / 2;
    const half2 = cat.ddBands[2] / 2;
    if (ui < half0) { score += 4; details.ulcer = `Low ulcer (${ui})`; }
    else if (ui < half1) { score += 1; details.ulcer = `Moderate ulcer (${ui})`; }
    else if (ui < half2) { score -= 2; details.ulcer = `High ulcer (${ui})`; }
    else { score -= 5; details.ulcer = `Severe ulcer (${ui})`; }
  }

  // Up-capture / Down-capture (mf-screener metric, benchmark required).
  // Reward funds that participate more on the upside than they suffer on the
  // downside. Spread > 20 is very good for equity, < -5 is concerning.
  if (risk.captureSpread !== null && risk.captureSpread !== undefined) {
    const spread = risk.captureSpread;
    if (spread > 25) { score += 6; details.capture = `Asymmetric upside (+${spread})`; }
    else if (spread > 10) { score += 3; details.capture = `Good capture spread (+${spread})`; }
    else if (spread > 0) { score += 1; details.capture = `Slightly positive capture (+${spread})`; }
    else if (spread > -10) { score -= 2; details.capture = `Weak capture (${spread})`; }
    else { score -= 5; details.capture = `Negative capture (${spread})`; }
  } else if (risk.downCapture !== null && risk.downCapture !== undefined) {
    // Fallback: at least look at down-capture alone if no up-capture
    if (risk.downCapture < 80) { score += 3; details.downCapture = `Resilient (${risk.downCapture})`; }
    else if (risk.downCapture > 110) { score -= 3; details.downCapture = `Amplifies losses (${risk.downCapture})`; }
  }

  // Beta — universal
  if (risk.beta !== null) {
    if (risk.beta < 0.5) { details.beta = `Defensive (${risk.beta})`; }
    else if (risk.beta < 1.2) { details.beta = `Market-like (${risk.beta})`; }
    else { score -= 3; details.beta = `Aggressive (${risk.beta})`; }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: score >= 70 ? 'Low Risk' : score >= 50 ? 'Moderate Risk' : 'High Risk',
  };
}

/**
 * Score momentum based on rolling returns.
 *
 * Extras (mf-screener metrics):
 *  - sipStability: { median, stdev, min, windows } from `computeSipXirrStability`.
 *    Median lifts the score (good past SIP path), stdev penalises (volatile path).
 */
export function scoreMomentum(rollingReturns, technicals, extras = {}) {
  let score = 50;
  const details = {};

  if (rollingReturns) {
    if (rollingReturns.return1M !== null) {
      if (rollingReturns.return1M > 10) { score += 8; details.m1M = `+${rollingReturns.return1M}%`; }
      else if (rollingReturns.return1M > 3) { score += 5; details.m1M = `+${rollingReturns.return1M}%`; }
      else if (rollingReturns.return1M > 0) { score += 2; details.m1M = `+${rollingReturns.return1M}%`; }
      else if (rollingReturns.return1M > -5) { score -= 2; details.m1M = `${rollingReturns.return1M}%`; }
      else { score -= 5; details.m1M = `${rollingReturns.return1M}%`; }
    }

    if (rollingReturns.return3M !== null) {
      if (rollingReturns.return3M > 15) { score += 8; details.m3M = `+${rollingReturns.return3M}%`; }
      else if (rollingReturns.return3M > 5) { score += 5; details.m3M = `+${rollingReturns.return3M}%`; }
      else if (rollingReturns.return3M > 0) { score += 2; details.m3M = `+${rollingReturns.return3M}%`; }
      else { score -= 5; details.m3M = `${rollingReturns.return3M}%`; }
    }

    if (rollingReturns.return1Y !== null) {
      if (rollingReturns.return1Y > 25) { score += 5; details.m1Y = `+${rollingReturns.return1Y}%`; }
      else if (rollingReturns.return1Y > 10) { score += 3; details.m1Y = `+${rollingReturns.return1Y}%`; }
      else if (rollingReturns.return1Y > 0) { score += 0; details.m1Y = `+${rollingReturns.return1Y}%`; }
      else { score -= 5; details.m1Y = `${rollingReturns.return1Y}%`; }
    }

    if (rollingReturns.consistency !== null) {
      if (rollingReturns.consistency > 80) { score += 5; details.consistency = `${rollingReturns.consistency}% positive`; }
      else if (rollingReturns.consistency > 60) { score += 2; details.consistency = `${rollingReturns.consistency}% positive`; }
      else { score -= 3; details.consistency = `${rollingReturns.consistency}% positive`; }
    }
  }

  if (technicals && !technicals.insufficient) {
    if (technicals.trendDirection === 'uptrend') { score += 5; details.trend = 'Uptrend'; }
    else if (technicals.trendDirection === 'downtrend') { score -= 5; details.trend = 'Downtrend'; }
    else { details.trend = 'Sideways'; }
  }

  // Rolling SIP-XIRR stability (mf-screener metric #4): reward stable, decent
  // SIP outcomes; penalise wildly variable ones even if point XIRR is great.
  const sip = extras?.sipStability;
  if (sip && sip.windows >= 6) {
    if (sip.median > 18) { score += 5; details.sipMedian = `Strong SIP path (med ${sip.median}%)`; }
    else if (sip.median > 10) { score += 2; details.sipMedian = `Healthy SIP path (med ${sip.median}%)`; }
    else if (sip.median > 4) { score += 0; details.sipMedian = `Average SIP path (med ${sip.median}%)`; }
    else { score -= 3; details.sipMedian = `Weak SIP path (med ${sip.median}%)`; }

    if (sip.stdev < 4) { score += 3; details.sipStdev = `Very stable (σ ${sip.stdev})`; }
    else if (sip.stdev < 8) { score += 1; details.sipStdev = `Stable (σ ${sip.stdev})`; }
    else if (sip.stdev > 14) { score -= 3; details.sipStdev = `Volatile path (σ ${sip.stdev})`; }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: score >= 70 ? 'Strong' : score >= 50 ? 'Moderate' : 'Weak',
  };
}

/**
 * Score the user's PERSONAL position in this fund.
 *
 * IMPORTANT: this is intentionally NOT folded into the composite recommendation. A great
 * fund bought yesterday will have meaningless XIRR and tiny portfolio weight; that should
 * not affect whether it's a good fund. The output of this function is meant to be shown
 * as a separate "Your position" panel in the UI.
 */
export function scorePersonal({ xirr, holdingDays, portfolioWeight, totalInvested, currentValue }) {
  let score = 50;
  const details = {};

  if (xirr !== null && xirr !== undefined) {
    if (xirr > 25) { score += 10; details.xirr = `Excellent (${xirr}%)`; }
    else if (xirr > 15) { score += 5; details.xirr = `Good (${xirr}%)`; }
    else if (xirr > 8) { score += 0; details.xirr = `Average (${xirr}%)`; }
    else if (xirr > 0) { score -= 3; details.xirr = `Below avg (${xirr}%)`; }
    else { score -= 8; details.xirr = `Negative (${xirr}%)`; }
  }

  if (holdingDays !== null) {
    if (holdingDays > 365 * 3) { score += 5; details.holding = `Long-term (${Math.round(holdingDays / 365)}Y)`; }
    else if (holdingDays > 365) { score += 3; details.holding = `>1 Year (LTCG eligible)`; }
    else { score -= 2; details.holding = `<1 Year (STCG)`; }
  }

  if (portfolioWeight !== null) {
    if (portfolioWeight > 20) { score -= 5; details.weight = `High concentration (${portfolioWeight.toFixed(1)}%)`; }
    else if (portfolioWeight > 10) { score -= 2; details.weight = `Moderate (${portfolioWeight.toFixed(1)}%)`; }
    else { score += 2; details.weight = `Balanced (${portfolioWeight.toFixed(1)}%)`; }
  }

  if (totalInvested && currentValue) {
    const returnPct = ((currentValue - totalInvested) / totalInvested) * 100;
    if (returnPct > 50) { score += 5; details.absReturn = `+${returnPct.toFixed(1)}%`; }
    else if (returnPct > 20) { score += 3; details.absReturn = `+${returnPct.toFixed(1)}%`; }
    else if (returnPct > 0) { score += 0; details.absReturn = `+${returnPct.toFixed(1)}%`; }
    else if (returnPct > -10) { score -= 3; details.absReturn = `${returnPct.toFixed(1)}%`; }
    else { score -= 8; details.absReturn = `${returnPct.toFixed(1)}%`; }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: score >= 60 ? 'Positive' : score >= 40 ? 'Neutral' : 'Concerning',
  };
}

// ============================================================
// COMPOSITE SCORING
// ============================================================
//
// Personal-position factors are NOT in the composite. The composite reflects
// fund/stock quality only.

const STOCK_WEIGHTS = {
  fundamental: 0.30,
  technical: 0.23,
  risk: 0.24,
  momentum: 0.23,
};

const MF_WEIGHTS = {
  fundamental: 0.34,  // "fund quality" — Morningstar, expense ratio, trailing returns, consistency
  technical: 0.13,
  risk: 0.32,         // Sharpe, drawdown, volatility (category-aware) live here
  momentum: 0.21,
};

/**
 * History-confidence haircut (mf-screener metric #2).
 *
 * Stops young funds from looking artificially great. The multiplier is applied
 * to the composite (post-weighting) score before clamping to [0, 100].
 * Mirrors the bands recommended in HANDOFF.md task #42.
 *
 * @param {number} historyDays approx number of trading days of NAV history
 * @returns {{multiplier:number, label:string}|null}
 */
function historyConfidence(historyDays) {
  if (historyDays == null) return null;
  const years = historyDays / 252;
  if (years < 1) return { multiplier: 0.55, label: `<1y history` };
  if (years < 2) return { multiplier: 0.72, label: `<2y history` };
  if (years < 3) return { multiplier: 0.88, label: `<3y history` };
  if (years < 5) return { multiplier: 0.96, label: `<5y history` };
  return { multiplier: 1.0, label: `≥5y history` };
}

/**
 * Compute final weighted score and recommendation.
 * `scores.personal` is accepted for backwards compatibility but ignored in the weighting.
 *
 * Accepts an optional `extras` object with `historyDays` to apply the
 * mf-screener history-confidence haircut. Without it, behaviour is unchanged.
 */
export function computeFinalScore(scores, weights = null, isMutualFund = false, extras = {}) {
  const { fundamental, technical, risk, momentum, personal } = scores;

  const w = weights || (isMutualFund ? MF_WEIGHTS : STOCK_WEIGHTS);

  const weightedScore =
    (fundamental?.score ?? 50) * w.fundamental +
    (technical?.score ?? 50) * w.technical +
    (risk?.score ?? 50) * w.risk +
    (momentum?.score ?? 50) * w.momentum;

  // Apply history-confidence haircut for mutual funds where we have NAV-history length
  let adjusted = weightedScore;
  let confidence = null;
  if (isMutualFund && extras?.historyDays != null) {
    confidence = historyConfidence(extras.historyDays);
    if (confidence) {
      // Pull short-history scores towards 50 (neutral) by a factor of (1 - mult).
      // This means a young fund with weightedScore 80 gets pulled down towards 50
      // (less buy-signal), and a fund with score 30 gets pulled up towards 50
      // (less aggressive sell signal). Better than blanket multiplication which
      // could turn moderate scores into ridiculous "Strong Sell".
      const neutralPull = 50;
      adjusted = neutralPull + (weightedScore - neutralPull) * confidence.multiplier;
    }
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, adjusted)));

  return {
    score: finalScore,
    rawScore: Math.round(weightedScore),
    confidence,
    recommendation: getRecommendation(finalScore),
    scores: { fundamental, technical, risk, momentum, personal },
    weights: w,
  };
}

function getRecommendation(score) {
  if (score >= 75) return { label: 'Strong Buy', color: '#16a34a', bgColor: '#dcfce7' };
  if (score >= 62) return { label: 'Buy', color: '#22c55e', bgColor: '#f0fdf4' };
  if (score >= 48) return { label: 'Hold', color: '#f59e0b', bgColor: '#fffbeb' };
  if (score >= 35) return { label: 'Sell', color: '#f97316', bgColor: '#fff7ed' };
  return { label: 'Strong Sell', color: '#dc2626', bgColor: '#fef2f2' };
}

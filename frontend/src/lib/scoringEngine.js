/**
 * Scoring Engine - Computes composite scores and generates Buy/Hold/Sell recommendations
 * for both stocks and mutual funds based on technical, fundamental, risk, and momentum signals.
 */

// ============================================================
// INDIVIDUAL DIMENSION SCORERS (each returns 0-100)
// ============================================================

/**
 * Score fundamentals (stocks only — from Yahoo quoteSummary)
 * For mutual funds, returns a quality score derived from rolling returns & risk instead.
 */
export function scoreFundamentals(fundamentals, isMutualFund = false, extraData = {}) {
  // For mutual funds: compute a "Fund Quality" score from returns & risk data
  if (isMutualFund || !fundamentals) {
    return scoreMFQuality(extraData);
  }

  let score = 50; // Start neutral
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
 * Score "Fund Quality" for mutual funds using rolling returns, risk metrics, category,
 * AND X-Ray data (Morningstar rating, expense ratio, trailing returns, equity holdings stats,
 * annual return consistency, beta, asset allocation).
 * Used as a replacement for the Fundamental dimension which is N/A for MFs.
 */
function scoreMFQuality(extraData = {}) {
  const { rollingReturns, riskMetrics, meta, xrayData } = extraData;

  // If no data at all, return neutral
  if (!rollingReturns && !riskMetrics && !xrayData) {
    return { score: 50, details: {}, label: 'No data' };
  }

  let score = 50;
  const details = {};

  // ── X-Ray Enhanced Metrics (when available from Portfolio X-Ray cache) ──

  if (xrayData) {
    // Morningstar Rating — gold-standard fund quality signal (1-5 stars)
    if (xrayData.stats?.morningstarRating != null) {
      const stars = xrayData.stats.morningstarRating;
      if (stars >= 5) { score += 12; details.morningstar = `★★★★★ Morningstar`; }
      else if (stars >= 4) { score += 8; details.morningstar = `★★★★ Morningstar`; }
      else if (stars >= 3) { score += 3; details.morningstar = `★★★ Morningstar`; }
      else if (stars >= 2) { score -= 3; details.morningstar = `★★ Morningstar`; }
      else { score -= 8; details.morningstar = `★ Morningstar`; }
    }

    // Expense Ratio — lower is better (directly eats returns)
    if (xrayData.profile?.expenseRatio != null) {
      const er = xrayData.profile.expenseRatio;
      if (er < 0.5) { score += 6; details.expense = `Very low expense (${er}%)`; }
      else if (er < 1.0) { score += 3; details.expense = `Low expense (${er}%)`; }
      else if (er < 1.5) { score += 0; details.expense = `Moderate expense (${er}%)`; }
      else if (er < 2.0) { score -= 3; details.expense = `High expense (${er}%)`; }
      else { score -= 6; details.expense = `Very high expense (${er}%)`; }
    }

    // Fund-level Equity PE — valuation of underlying holdings
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

    // Yahoo Trailing Returns — more reliable than our computed rolling returns
    const tr = xrayData.trailingReturns;
    if (tr) {
      // Prefer Yahoo's 1Y trailing return over our computed one
      if (tr.oneYear != null) {
        if (tr.oneYear > 25) { score += 10; details.trRet1Y = `Excellent 1Y (${tr.oneYear > 0 ? '+' : ''}${tr.oneYear}%)`; }
        else if (tr.oneYear > 15) { score += 6; details.trRet1Y = `Good 1Y (+${tr.oneYear}%)`; }
        else if (tr.oneYear > 8) { score += 3; details.trRet1Y = `Average 1Y (+${tr.oneYear}%)`; }
        else if (tr.oneYear > 0) { score += 0; details.trRet1Y = `Low 1Y (+${tr.oneYear}%)`; }
        else { score -= 6; details.trRet1Y = `Negative 1Y (${tr.oneYear}%)`; }
      }

      // 3Y and 5Y trailing CAGR — long-term quality signal
      if (tr.threeYear != null) {
        if (tr.threeYear > 18) { score += 5; details.trRet3Y = `Strong 3Y CAGR (+${tr.threeYear}%)`; }
        else if (tr.threeYear > 12) { score += 3; details.trRet3Y = `Good 3Y CAGR (+${tr.threeYear}%)`; }
        else if (tr.threeYear > 5) { score += 0; details.trRet3Y = `Average 3Y CAGR (+${tr.threeYear}%)`; }
        else { score -= 4; details.trRet3Y = `Weak 3Y CAGR (${tr.threeYear}%)`; }
      }

      if (tr.fiveYear != null) {
        if (tr.fiveYear > 16) { score += 4; details.trRet5Y = `Strong 5Y CAGR (+${tr.fiveYear}%)`; }
        else if (tr.fiveYear > 10) { score += 2; details.trRet5Y = `Good 5Y CAGR (+${tr.fiveYear}%)`; }
        else if (tr.fiveYear > 5) { score += 0; details.trRet5Y = `Average 5Y CAGR (+${tr.fiveYear}%)`; }
        else { score -= 3; details.trRet5Y = `Weak 5Y CAGR (${tr.fiveYear}%)`; }
      }
    }

    // Worst Year / Best Year — downside risk insight
    if (xrayData.performance?.worstYear != null) {
      const wy = xrayData.performance.worstYear;
      if (wy > -5) { score += 4; details.worstYear = `Mild worst year (${wy}%)`; }
      else if (wy > -15) { score += 1; details.worstYear = `Moderate worst year (${wy}%)`; }
      else if (wy > -25) { score -= 2; details.worstYear = `Tough worst year (${wy}%)`; }
      else { score -= 5; details.worstYear = `Severe worst year (${wy}%)`; }
    }

    // Years Up / Years Down ratio
    if (xrayData.performance?.yearsUp != null && xrayData.performance?.yearsDown != null) {
      const totalYears = xrayData.performance.yearsUp + xrayData.performance.yearsDown;
      if (totalYears > 0) {
        const upRatio = xrayData.performance.yearsUp / totalYears;
        if (upRatio > 0.85) { score += 4; details.upDown = `${xrayData.performance.yearsUp}/${totalYears} years positive`; }
        else if (upRatio > 0.7) { score += 2; details.upDown = `${xrayData.performance.yearsUp}/${totalYears} years positive`; }
        else if (upRatio < 0.5) { score -= 3; details.upDown = `${xrayData.performance.yearsUp}/${totalYears} years positive`; }
      }
    }

    // Beta (3Y) — from X-Ray's defaultKeyStatistics
    if (xrayData.stats?.beta != null) {
      const beta = xrayData.stats.beta;
      if (beta < 0.7) { score += 3; details.beta = `Defensive (β ${beta})`; }
      else if (beta < 1.1) { score += 1; details.beta = `Market-aligned (β ${beta})`; }
      else if (beta > 1.3) { score -= 3; details.beta = `Aggressive (β ${beta})`; }
    }

    // Fund category from profile
    if (xrayData.profile?.category) {
      details.category = xrayData.profile.category;
    }
  }

  // ── Computed Metrics (from NAV-based analysis — fallback if X-Ray not available) ──

  // 1Y return — skip if we already have Yahoo trailing return
  if (!xrayData?.trailingReturns?.oneYear && rollingReturns?.return1Y != null) {
    if (rollingReturns.return1Y > 25) { score += 12; details.ret1Y = `Strong 1Y return (+${rollingReturns.return1Y}%)`; }
    else if (rollingReturns.return1Y > 15) { score += 8; details.ret1Y = `Good 1Y return (+${rollingReturns.return1Y}%)`; }
    else if (rollingReturns.return1Y > 8) { score += 4; details.ret1Y = `Average 1Y return (+${rollingReturns.return1Y}%)`; }
    else if (rollingReturns.return1Y > 0) { score += 0; details.ret1Y = `Low 1Y return (+${rollingReturns.return1Y}%)`; }
    else { score -= 8; details.ret1Y = `Negative 1Y return (${rollingReturns.return1Y}%)`; }
  }

  // 3M return — short-term quality signal
  if (rollingReturns?.return3M != null) {
    if (rollingReturns.return3M > 10) { score += 5; details.ret3M = `Strong 3M (+${rollingReturns.return3M}%)`; }
    else if (rollingReturns.return3M > 3) { score += 2; details.ret3M = `Positive 3M (+${rollingReturns.return3M}%)`; }
    else if (rollingReturns.return3M < -5) { score -= 5; details.ret3M = `Weak 3M (${rollingReturns.return3M}%)`; }
  }

  // Consistency
  if (rollingReturns?.consistency != null) {
    if (rollingReturns.consistency > 85) { score += 8; details.consistency = `Very consistent (${rollingReturns.consistency}% positive)`; }
    else if (rollingReturns.consistency > 70) { score += 5; details.consistency = `Consistent (${rollingReturns.consistency}% positive)`; }
    else if (rollingReturns.consistency > 50) { score += 0; details.consistency = `Average (${rollingReturns.consistency}% positive)`; }
    else { score -= 5; details.consistency = `Inconsistent (${rollingReturns.consistency}% positive)`; }
  }

  // Sharpe Ratio — key risk-adjusted quality metric
  if (riskMetrics?.sharpeRatio != null) {
    if (riskMetrics.sharpeRatio > 1.5) { score += 8; details.sharpe = `Excellent risk-adj (${riskMetrics.sharpeRatio})`; }
    else if (riskMetrics.sharpeRatio > 1) { score += 5; details.sharpe = `Good risk-adj (${riskMetrics.sharpeRatio})`; }
    else if (riskMetrics.sharpeRatio > 0.5) { score += 2; details.sharpe = `Average risk-adj (${riskMetrics.sharpeRatio})`; }
    else if (riskMetrics.sharpeRatio > 0) { score -= 2; details.sharpe = `Below avg risk-adj (${riskMetrics.sharpeRatio})`; }
    else { score -= 5; details.sharpe = `Negative risk-adj (${riskMetrics.sharpeRatio})`; }
  }

  // Max Drawdown
  if (riskMetrics?.maxDrawdown != null) {
    if (riskMetrics.maxDrawdown < 8) { score += 5; details.drawdown = `Low drawdown (-${riskMetrics.maxDrawdown}%)`; }
    else if (riskMetrics.maxDrawdown < 15) { score += 2; details.drawdown = `Moderate drawdown (-${riskMetrics.maxDrawdown}%)`; }
    else if (riskMetrics.maxDrawdown > 25) { score -= 5; details.drawdown = `High drawdown (-${riskMetrics.maxDrawdown}%)`; }
  }

  // Fund category info (fallback to AMFI meta)
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

  // RSI
  if (technicals.rsi !== null) {
    if (technicals.rsi >= 70) { score -= 10; details.rsi = `Overbought (${technicals.rsi})`; }
    else if (technicals.rsi >= 60) { score += 3; details.rsi = `Bullish (${technicals.rsi})`; }
    else if (technicals.rsi >= 40) { score += 5; details.rsi = `Neutral (${technicals.rsi})`; }
    else if (technicals.rsi >= 30) { score += 3; details.rsi = `Bearish (${technicals.rsi})`; }
    else { score += 10; details.rsi = `Oversold - potential buy (${technicals.rsi})`; }
  }

  // MACD
  if (technicals.macdBullish !== null) {
    if (technicals.macdBullish) { score += 8; details.macd = 'Bullish crossover'; }
    else { score -= 5; details.macd = 'Bearish crossover'; }
  }

  // Price vs SMA200
  if (technicals.priceAboveSMA200 !== null) {
    if (technicals.priceAboveSMA200) { score += 8; details.sma200 = 'Above 200 SMA (uptrend)'; }
    else { score -= 8; details.sma200 = 'Below 200 SMA (downtrend)'; }
  }

  // Price vs SMA50
  if (technicals.priceAboveSMA50 !== null) {
    if (technicals.priceAboveSMA50) { score += 5; details.sma50 = 'Above 50 SMA'; }
    else { score -= 5; details.sma50 = 'Below 50 SMA'; }
  }

  // Golden/Death Cross
  if (technicals.crossSignal === 'golden_cross') { score += 10; details.cross = 'Golden Cross detected!'; }
  else if (technicals.crossSignal === 'death_cross') { score -= 10; details.cross = 'Death Cross detected!'; }

  // Bollinger %B
  if (technicals.bollingerPercentB !== null) {
    if (technicals.bollingerPercentB > 1) { score -= 5; details.bollinger = 'Above upper band'; }
    else if (technicals.bollingerPercentB > 0.8) { score -= 2; details.bollinger = 'Near upper band'; }
    else if (technicals.bollingerPercentB < 0) { score += 5; details.bollinger = 'Below lower band - potential buy'; }
    else if (technicals.bollingerPercentB < 0.2) { score += 2; details.bollinger = 'Near lower band'; }
    else { details.bollinger = 'Mid-range'; }
  }

  // ADX (trend strength)
  if (technicals.adx !== null) {
    if (technicals.adx > 40) { details.adx = `Very strong trend (${technicals.adx})`; }
    else if (technicals.adx > 25) { details.adx = `Trending (${technicals.adx})`; }
    else { details.adx = `No clear trend (${technicals.adx})`; }
  }

  // 52-week position
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
 * Score risk metrics
 */
export function scoreRisk(risk) {
  if (!risk || risk.insufficient) {
    return { score: 50, details: {}, label: 'Insufficient data' };
  }

  let score = 50;
  const details = {};

  // Sharpe Ratio
  if (risk.sharpeRatio !== null) {
    if (risk.sharpeRatio > 2) { score += 15; details.sharpe = `Excellent (${risk.sharpeRatio})`; }
    else if (risk.sharpeRatio > 1) { score += 10; details.sharpe = `Good (${risk.sharpeRatio})`; }
    else if (risk.sharpeRatio > 0.5) { score += 3; details.sharpe = `Average (${risk.sharpeRatio})`; }
    else if (risk.sharpeRatio > 0) { score -= 5; details.sharpe = `Below average (${risk.sharpeRatio})`; }
    else { score -= 10; details.sharpe = `Negative (${risk.sharpeRatio})`; }
  }

  // Sortino Ratio
  if (risk.sortinoRatio !== null) {
    if (risk.sortinoRatio > 2) { score += 5; details.sortino = `Excellent (${risk.sortinoRatio})`; }
    else if (risk.sortinoRatio > 1) { score += 3; details.sortino = `Good (${risk.sortinoRatio})`; }
    else if (risk.sortinoRatio > 0) { score += 0; details.sortino = `Average (${risk.sortinoRatio})`; }
    else { score -= 5; details.sortino = `Poor (${risk.sortinoRatio})`; }
  }

  // Volatility
  if (risk.annualizedVolatility !== null) {
    if (risk.annualizedVolatility < 10) { score += 8; details.volatility = `Low (${risk.annualizedVolatility}%)`; }
    else if (risk.annualizedVolatility < 20) { score += 3; details.volatility = `Moderate (${risk.annualizedVolatility}%)`; }
    else if (risk.annualizedVolatility < 30) { score -= 3; details.volatility = `High (${risk.annualizedVolatility}%)`; }
    else { score -= 8; details.volatility = `Very high (${risk.annualizedVolatility}%)`; }
  }

  // Max Drawdown
  if (risk.maxDrawdown !== null) {
    if (risk.maxDrawdown < 5) { score += 8; details.maxDD = `Minimal (${risk.maxDrawdown}%)`; }
    else if (risk.maxDrawdown < 15) { score += 3; details.maxDD = `Moderate (${risk.maxDrawdown}%)`; }
    else if (risk.maxDrawdown < 30) { score -= 3; details.maxDD = `Significant (${risk.maxDrawdown}%)`; }
    else { score -= 8; details.maxDD = `Severe (${risk.maxDrawdown}%)`; }
  }

  // Beta
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
 * Score momentum based on rolling returns
 */
export function scoreMomentum(rollingReturns, technicals) {
  let score = 50;
  const details = {};

  if (rollingReturns) {
    // Short-term momentum (1M)
    if (rollingReturns.return1M !== null) {
      if (rollingReturns.return1M > 10) { score += 8; details.m1M = `+${rollingReturns.return1M}%`; }
      else if (rollingReturns.return1M > 3) { score += 5; details.m1M = `+${rollingReturns.return1M}%`; }
      else if (rollingReturns.return1M > 0) { score += 2; details.m1M = `+${rollingReturns.return1M}%`; }
      else if (rollingReturns.return1M > -5) { score -= 2; details.m1M = `${rollingReturns.return1M}%`; }
      else { score -= 5; details.m1M = `${rollingReturns.return1M}%`; }
    }

    // Mid-term momentum (3M)
    if (rollingReturns.return3M !== null) {
      if (rollingReturns.return3M > 15) { score += 8; details.m3M = `+${rollingReturns.return3M}%`; }
      else if (rollingReturns.return3M > 5) { score += 5; details.m3M = `+${rollingReturns.return3M}%`; }
      else if (rollingReturns.return3M > 0) { score += 2; details.m3M = `+${rollingReturns.return3M}%`; }
      else { score -= 5; details.m3M = `${rollingReturns.return3M}%`; }
    }

    // Long-term (1Y)
    if (rollingReturns.return1Y !== null) {
      if (rollingReturns.return1Y > 25) { score += 5; details.m1Y = `+${rollingReturns.return1Y}%`; }
      else if (rollingReturns.return1Y > 10) { score += 3; details.m1Y = `+${rollingReturns.return1Y}%`; }
      else if (rollingReturns.return1Y > 0) { score += 0; details.m1Y = `+${rollingReturns.return1Y}%`; }
      else { score -= 5; details.m1Y = `${rollingReturns.return1Y}%`; }
    }

    // Consistency
    if (rollingReturns.consistency !== null) {
      if (rollingReturns.consistency > 80) { score += 5; details.consistency = `${rollingReturns.consistency}% positive`; }
      else if (rollingReturns.consistency > 60) { score += 2; details.consistency = `${rollingReturns.consistency}% positive`; }
      else { score -= 3; details.consistency = `${rollingReturns.consistency}% positive`; }
    }
  }

  // Trend from technicals
  if (technicals && !technicals.insufficient) {
    if (technicals.trendDirection === 'uptrend') { score += 5; details.trend = 'Uptrend'; }
    else if (technicals.trendDirection === 'downtrend') { score -= 5; details.trend = 'Downtrend'; }
    else { details.trend = 'Sideways'; }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    details,
    label: score >= 70 ? 'Strong' : score >= 50 ? 'Moderate' : 'Weak',
  };
}

/**
 * Score personal portfolio factors
 * @param {Object} params
 */
export function scorePersonal({ xirr, holdingDays, portfolioWeight, totalInvested, currentValue }) {
  let score = 50;
  const details = {};

  // XIRR performance
  if (xirr !== null && xirr !== undefined) {
    if (xirr > 25) { score += 10; details.xirr = `Excellent (${xirr}%)`; }
    else if (xirr > 15) { score += 5; details.xirr = `Good (${xirr}%)`; }
    else if (xirr > 8) { score += 0; details.xirr = `Average (${xirr}%)`; }
    else if (xirr > 0) { score -= 3; details.xirr = `Below avg (${xirr}%)`; }
    else { score -= 8; details.xirr = `Negative (${xirr}%)`; }
  }

  // Holding period
  if (holdingDays !== null) {
    if (holdingDays > 365 * 3) { score += 5; details.holding = `Long-term (${Math.round(holdingDays / 365)}Y)`; }
    else if (holdingDays > 365) { score += 3; details.holding = `>1 Year (LTCG eligible)`; }
    else { score -= 2; details.holding = `<1 Year (STCG)`; }
  }

  // Portfolio concentration
  if (portfolioWeight !== null) {
    if (portfolioWeight > 20) { score -= 5; details.weight = `High concentration (${portfolioWeight.toFixed(1)}%)`; }
    else if (portfolioWeight > 10) { score -= 2; details.weight = `Moderate (${portfolioWeight.toFixed(1)}%)`; }
    else { score += 2; details.weight = `Balanced (${portfolioWeight.toFixed(1)}%)`; }
  }

  // Absolute return
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

const STOCK_WEIGHTS = {
  fundamental: 0.25,
  technical: 0.20,
  risk: 0.20,
  momentum: 0.20,
  personal: 0.15,
};

// MF weights: With X-Ray data (Morningstar, expense ratio, trailing returns),
// the "fundamental" dimension is much richer and more reliable
const MF_WEIGHTS = {
  fundamental: 0.25, // "fund quality" score — now enriched with X-Ray data
  technical: 0.15,
  risk: 0.25,
  momentum: 0.20,
  personal: 0.15,
};

/**
 * Compute final weighted score and recommendation
 * @param {Object} scores - Dimension scores
 * @param {Object} weights - Optional custom weights
 * @param {boolean} isMutualFund - Whether to use MF-specific weights
 */
export function computeFinalScore(scores, weights = null, isMutualFund = false) {
  const { fundamental, technical, risk, momentum, personal } = scores;

  const w = weights || (isMutualFund ? MF_WEIGHTS : STOCK_WEIGHTS);

  const weightedScore =
    (fundamental?.score || 50) * w.fundamental +
    (technical?.score || 50) * w.technical +
    (risk?.score || 50) * w.risk +
    (momentum?.score || 50) * w.momentum +
    (personal?.score || 50) * w.personal;

  const finalScore = Math.round(Math.max(0, Math.min(100, weightedScore)));

  return {
    score: finalScore,
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

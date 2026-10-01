/**
 * Plain-English explanations for every metric shown in Fund Insights.
 * Key = the label displayed in the UI.
 */

const TOOLTIPS = {
  // ─── Technical Indicators ──────────────────
  'RSI (14)':
    'Relative Strength Index measures how fast the price has been going up or down over the last 14 days. Above 70 means it may be "overbought" (too expensive short-term), below 30 means "oversold" (possibly a bargain).',
  'MACD':
    'Moving Average Convergence Divergence compares a fast and a slow moving average. "Bullish" means the fast average just crossed above the slow one — a positive sign. "Bearish" is the opposite.',
  'Trend':
    'Shows whether the price is generally going up (uptrend), down (downtrend) or sideways, based on the direction of the 50-day moving average.',
  'Trend Strength':
    'Measured by ADX. "Strong" means the current trend (up or down) has real conviction. "None" means the price is just drifting with no clear direction.',
  'SMA 50':
    '50-day Simple Moving Average — the average closing price over the last 50 trading days. If the current price is above this, the short-term trend is positive.',
  'SMA 200':
    '200-day Simple Moving Average — the average closing price over the last 200 days. Price above this line is a classic sign of a long-term uptrend.',
  'Bollinger %B':
    'Tells you where the current price sits relative to its normal trading range. Near 0 means the price is at the bottom of its range (potentially cheap), near 1 means at the top (potentially overpriced).',
  'ADX':
    'Average Directional Index measures how strong a trend is (not its direction). Above 25 = trending, above 40 = strongly trending, below 20 = no clear trend.',
  '52W Range':
    'Shows where the current price sits between its 52-week low (0%) and 52-week high (100%). Near 0% means the price is close to its yearly low.',
  'From 52W High':
    'How far the current price is from its 52-week high. A small negative number (like -5%) means it\'s close to the high; a large negative number means it has fallen significantly.',
  'Cross Signal':
    'A "Golden Cross" happens when the 50-day average crosses above the 200-day average — historically a bullish sign. A "Death Cross" is the opposite — a bearish sign.',
  'Momentum':
    'A composite of RSI and MACD signals. "Bullish" = both indicators are positive. "Overbought" = may have risen too fast. "Oversold" = may have fallen too much.',

  // ─── Fundamentals ──────────────────────────
  'PE (Trailing)':
    'Price-to-Earnings ratio based on the last 12 months\' actual earnings. It tells you how much you pay for each ₹1 of profit. Lower is generally cheaper, but compare within the same industry.',
  'PE (Forward)':
    'Price-to-Earnings ratio based on estimated future earnings. If this is lower than Trailing PE, analysts expect earnings to grow.',
  'PEG Ratio':
    'PE divided by earnings growth rate. Below 1 suggests the stock is cheap relative to its growth. Above 2 suggests it\'s expensive for the growth it offers.',
  'Price/Book':
    'Price-to-Book compares the stock price to the company\'s net asset value. Below 1 means you\'re buying the company for less than its assets are worth (rare for good companies).',
  'ROE':
    'Return on Equity — how much profit the company makes for each ₹1 of shareholder money. Above 15% is good, above 25% is excellent.',
  'ROA':
    'Return on Assets — how efficiently the company uses all its assets to generate profit. Higher is better.',
  'Debt/Equity':
    'How much the company has borrowed compared to shareholder funds. Below 50 is conservative, above 150 is risky. Very industry-dependent.',
  'Current Ratio':
    'Can the company pay its short-term bills? Above 1.5 is comfortable, below 1 means it might struggle to meet obligations.',
  'Revenue Growth':
    'How fast the company\'s sales are growing year-over-year. Positive = growing, negative = shrinking.',
  'Earnings Growth':
    'How fast profits are growing. This is what ultimately drives stock price over time.',
  'Profit Margin':
    'What percentage of revenue is actual profit after all expenses. Higher margins mean the company keeps more of each rupee it earns.',
  'Dividend Yield':
    'Annual dividend as a percentage of the current stock price. This is "passive income" you receive just for holding the stock.',
  'Beta':
    'Measures how much the stock moves compared to the market. Beta 1 = moves with the market. Beta > 1 = more volatile. Beta < 1 = less volatile (defensive).',
  'Market Cap':
    'Total market value of the company (price × total shares). Larger companies tend to be more stable but may grow slower.',
  'Sector': 'The broad industry sector the company belongs to (e.g., Technology, Healthcare, Financial).',
  'Industry': 'The specific industry within the sector (e.g., Software, Pharmaceuticals, Banks).',

  // ─── Risk Metrics ──────────────────────────
  'Volatility (Ann.)':
    'How much the price typically swings in a year. Below 15% is low-risk, 15-25% is moderate, above 25% is high-risk. Higher volatility = bigger ups AND downs.',
  'Sharpe Ratio':
    'Return earned per unit of risk taken. Above 1 is good (earning more than the risk you\'re taking), above 2 is excellent. Below 0 means you\'re losing money.',
  'Sortino Ratio':
    'Like Sharpe, but only counts downside risk (bad volatility). A high Sortino means good returns without too many scary drops.',
  'Max Drawdown':
    'The biggest peak-to-trough fall in the period. If a fund has -30% max drawdown, at its worst point it fell 30% from its peak. Smaller is better.',
  'VaR (95%)':
    'Value at Risk — on 95% of days, you won\'t lose more than this percentage. E.g., VaR -2% means on a bad day (5% chance), you could lose 2%+ in a single day.',
  'Alpha':
    'Extra return earned above what you\'d expect given the risk taken (compared to benchmark). Positive alpha = fund manager is adding value. Negative = underperforming.',
  'R²':
    'How closely the fund follows its benchmark. 90%+ means it moves almost identically to the benchmark. Low R² means the fund has its own unique behavior.',
  'Ulcer Index':
    'Combines the depth AND duration of drawdowns into one number. Where Max Drawdown only shows the single worst dip, Ulcer Index also penalises funds that stay underwater for long stretches. Lower is better.',
  'Ulcer Performance Index':
    'Excess return per unit of ulcer pain — like Sharpe but using Ulcer Index instead of volatility. Higher = better recovery-adjusted returns.',
  'Up Capture':
    'On days the benchmark rose, how much of the move did the fund capture? 100 = matched the market, >100 = participated more than the market on up days, <100 = lagged.',
  'Down Capture':
    'On days the benchmark fell, how much of the loss did the fund take? 100 = fell with the market, <100 = cushioned the fall (good), >100 = amplified the loss (bad).',
  'Capture Spread':
    'Up Capture minus Down Capture. Positive means the fund participates more on the upside than it suffers on the downside — the gold standard for active management.',
  'SIP Stability (Median)':
    'Median annualised return across all simulated 12-month-SIP + 12-month-hold windows in the fund\'s history. Captures the typical investor experience, not just the point-in-time number.',
  'SIP Stability (Std-Dev)':
    'How much the simulated SIP outcomes vary from window to window. Lower = more predictable; a great point XIRR with a huge stdev is path-dependent luck.',
  'History Confidence':
    'How much NAV history is available. Young funds (<3y) have their composite score pulled towards neutral because their numbers are noisier — a brilliant 1-year track record might just be a lucky regime.',

  // ─── Rolling Returns ───────────────────────
  '1 Week': 'Return over the last 5 trading days.',
  '1 Month': 'Return over the last ~21 trading days (1 calendar month).',
  '3 Months': 'Return over the last ~63 trading days (3 calendar months).',
  '6 Months': 'Return over the last ~126 trading days (6 calendar months).',
  '1 Year': 'Return over the last ~252 trading days (1 calendar year).',

  // ─── Score Dimensions ──────────────────────
  'Fundamental':
    'Score based on company financials — PE ratio, growth, profitability, debt levels, and analyst recommendations. Only available for stocks (not mutual funds).',
  'Fund Quality':
    'For mutual funds, this replaces Fundamentals. It scores the fund based on its 1-year & 3-month returns, rolling consistency (how often it delivered positive returns), Sharpe ratio (risk-adjusted return), and max drawdown. Higher = better quality fund.',
  'Technical':
    'Score based on price patterns — RSI, MACD, moving averages, Bollinger Bands, and trend signals. Higher = more bullish technical setup.',
  'Risk':
    'Score based on how risky the investment is — volatility, Sharpe ratio, max drawdown. Higher = better risk-adjusted returns.',
  'Momentum':
    'Score based on recent performance trajectory — 1M, 3M, 1Y returns and trend direction. Higher = stronger upward momentum.',
  'Personal':
    'Score based on YOUR portfolio — your XIRR, how long you\'ve held it, how concentrated your position is. Higher = performing well for you personally.',

  // ─── Fund Info ─────────────────────────────
  'Fund House': 'The asset management company (AMC) that manages this mutual fund.',
  'Category': 'The SEBI-defined category of the mutual fund (e.g., Large Cap, Mid Cap, Flexi Cap).',
  'Type': 'Whether it\'s an Open Ended, Close Ended, or Interval fund.',

  // ─── Discover ──────────────────────────────
  'Return 1Y': 'How much the fund/stock returned over the last year.',
  'Return 3M': 'How much the fund/stock returned over the last 3 months.',
  'Consistency': 'Percentage of rolling 1-year periods where the return was positive. Higher = more reliable returns over time.',
};

export function getTooltip(label) {
  return TOOLTIPS[label] || null;
}

export default TOOLTIPS;

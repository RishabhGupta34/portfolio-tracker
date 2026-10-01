/**
 * Account scorecard — wealth-manager view of a single account's health.
 *
 * Inputs: a list of fund objects belonging to the account (with transactions, type, current_nav).
 * Output: dimension scores (0-100) and a composite, plus the diagnostics that produced them.
 *
 * The composite avoids favoring whichever account happens to be largest. Returns are
 * normalized as XIRR-vs-benchmark, not absolute rupees, so a small account with great
 * picks can outscore a large under-allocated one.
 */

const EQUITY_TYPES = ['stock', 'mutual_fund', 'private_share', 'esop'];
const DEBT_TYPES = ['fd', 'ppf', 'epf'];
const RISK_FREE_XIRR = 7.0; // PPF / 1Y FD baseline

function fundCurrentValue(fund) {
  let units = 0;
  let invested = 0;
  for (const txn of fund.transactions || []) {
    if (txn.transaction_type === 'buy' || txn.transaction_type === 'bonus') {
      invested += txn.amount || 0;
      units += txn.units || 0;
    } else if (txn.transaction_type === 'sell') {
      if (units > 0) invested -= (txn.units / units) * invested;
      units -= txn.units;
    }
  }
  const nav = fund.current_nav != null
    ? fund.current_nav
    : (fund.transactions && fund.transactions.length > 0
        ? fund.transactions[fund.transactions.length - 1].nav
        : 0);
  // For deposits we treat invested as the value (interest is booked as txn rows).
  if (DEBT_TYPES.includes(fund.type)) {
    return { value: invested, invested, units };
  }
  return { value: units * nav, invested, units };
}

function fundXirr(fund) {
  // Lightweight XIRR via Newton-Raphson, copy of backend logic.
  const flows = [];
  const dates = [];
  for (const t of fund.transactions || []) {
    if (t.transaction_type === 'bonus') continue;
    if (!(t.amount > 0)) continue;
    const d = new Date(t.date);
    if (t.transaction_type === 'buy') {
      flows.push(-t.amount);
      dates.push(d);
    } else if (t.transaction_type === 'sell') {
      flows.push(t.amount);
      dates.push(d);
    }
  }
  if (!flows.length) return null;
  const { value } = fundCurrentValue(fund);
  if (value <= 0) return null;
  flows.push(value);
  dates.push(new Date());
  if (flows.every(f => f <= 0) || flows.every(f => f >= 0)) return null;
  const t0 = Math.min(...dates.map(d => d.getTime()));
  const days = dates.map(d => (d.getTime() - t0) / (1000 * 60 * 60 * 24));
  if (Math.max(...days) < 7) return null;
  const f = (r) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, days[i] / 365), 0);
  const fp = (r) => flows.reduce((s, cf, i) => s - (days[i] / 365) * cf / Math.pow(1 + r, days[i] / 365 + 1), 0);
  for (const guess of [0.1, 0.0, -0.1, 0.5, -0.5]) {
    let r = guess;
    for (let i = 0; i < 100; i++) {
      const fr = f(r);
      const dfr = fp(r);
      if (!isFinite(fr) || !isFinite(dfr) || dfr === 0) break;
      const next = r - fr / dfr;
      if (Math.abs(next - r) < 1e-7) {
        r = next;
        if (r > -0.99 && r < 10) return Math.round(r * 10000) / 100;
        break;
      }
      r = next;
    }
  }
  return null;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Scores 0-100 across 4 dimensions:
 *  1. Returns       — XIRR vs risk-free, capped
 *  2. Diversification — concentration penalty (HHI on per-fund value)
 *  3. Allocation    — equity/debt mix vs target (default 60/40 with ±20 tolerance band)
 *  4. Liquidity     — fraction of value in non-locked instruments (PPF/EPF lock down score)
 */
export function computeAccountScorecard(account, funds, options = {}) {
  const targetEquityPct = options.targetEquityPct != null ? options.targetEquityPct : 60;
  const tolerance = options.allocationTolerance != null ? options.allocationTolerance : 20;

  const owned = (funds || []).filter(f => f.account_id === account.id);
  if (owned.length === 0) {
    return {
      composite: null,
      scores: { returns: null, diversification: null, allocation: null, liquidity: null },
      diagnostics: { reason: 'no funds in account' },
    };
  }

  const perFund = owned.map(f => {
    const cv = fundCurrentValue(f);
    const xirr = EQUITY_TYPES.includes(f.type) ? fundXirr(f) : (f.interest_rate != null ? f.interest_rate : null);
    return { fund: f, ...cv, xirr };
  });

  const totalValue = perFund.reduce((s, x) => s + x.value, 0);
  const totalInvested = perFund.reduce((s, x) => s + x.invested, 0);

  // 1. Returns: weighted avg XIRR vs risk-free baseline
  let weightedXirr = 0;
  let xirrWeight = 0;
  for (const x of perFund) {
    if (x.xirr != null && x.value > 0) {
      weightedXirr += x.xirr * x.value;
      xirrWeight += x.value;
    }
  }
  const blendedXirr = xirrWeight > 0 ? weightedXirr / xirrWeight : null;
  let returnsScore = null;
  if (blendedXirr != null) {
    // 0 at risk-free - 5pp, 100 at risk-free + 12pp; linear in between.
    returnsScore = clamp(((blendedXirr - (RISK_FREE_XIRR - 5)) / 17) * 100, 0, 100);
    returnsScore = Math.round(returnsScore);
  }

  // 2. Diversification: HHI on per-fund value (excluding deposits)
  const equityFunds = perFund.filter(x => EQUITY_TYPES.includes(x.fund.type) && x.value > 0);
  const equityValue = equityFunds.reduce((s, x) => s + x.value, 0);
  let diversificationScore = null;
  if (equityValue > 0 && equityFunds.length > 0) {
    const hhi = equityFunds.reduce((s, x) => {
      const w = x.value / equityValue;
      return s + w * w;
    }, 0);
    // HHI of 1 (single fund) → 0; HHI of 1/n → 100. Scale so 5+ equal funds ~85.
    diversificationScore = Math.round(clamp((1 - hhi) * 100, 0, 100));
  }

  // 3. Allocation: equity vs debt vs target
  const debtValue = perFund.filter(x => DEBT_TYPES.includes(x.fund.type)).reduce((s, x) => s + x.value, 0);
  const investableValue = equityValue + debtValue;
  let allocationScore = null;
  let equityPct = null;
  if (investableValue > 0) {
    equityPct = (equityValue / investableValue) * 100;
    const drift = Math.abs(equityPct - targetEquityPct);
    allocationScore = Math.round(clamp(100 - (drift / tolerance) * 100, 0, 100));
  }

  // 4. Liquidity: fraction NOT in PPF/EPF (long-lock instruments)
  const lockedTypes = ['ppf', 'epf'];
  const lockedValue = perFund.filter(x => lockedTypes.includes(x.fund.type)).reduce((s, x) => s + x.value, 0);
  let liquidityScore = null;
  if (totalValue > 0) {
    liquidityScore = Math.round(clamp((1 - lockedValue / totalValue) * 100, 0, 100));
  }

  const dimensions = [returnsScore, diversificationScore, allocationScore, liquidityScore];
  const valid = dimensions.filter(s => s != null);
  const composite = valid.length > 0
    ? Math.round(valid.reduce((s, x) => s + x, 0) / valid.length)
    : null;

  // Identify weakest dimension for the "what to fix" hint.
  const labelMap = {
    returns: 'Returns',
    diversification: 'Diversification',
    allocation: 'Asset allocation',
    liquidity: 'Liquidity',
  };
  let weakest = null;
  let weakestScore = Infinity;
  for (const [k, v] of Object.entries({ returns: returnsScore, diversification: diversificationScore, allocation: allocationScore, liquidity: liquidityScore })) {
    if (v != null && v < weakestScore) {
      weakest = k;
      weakestScore = v;
    }
  }

  return {
    composite,
    scores: { returns: returnsScore, diversification: diversificationScore, allocation: allocationScore, liquidity: liquidityScore },
    diagnostics: {
      totalValue,
      totalInvested,
      blendedXirr,
      equityPct,
      lockedPct: totalValue > 0 ? (lockedValue / totalValue) * 100 : null,
      fundCount: owned.length,
      equityFundCount: equityFunds.length,
      weakest,
      weakestLabel: weakest ? labelMap[weakest] : null,
      targetEquityPct,
    },
  };
}

export function scoreLabel(score) {
  if (score == null) return { label: 'N/A', color: 'gray' };
  if (score >= 80) return { label: 'Excellent', color: 'green' };
  if (score >= 65) return { label: 'Good', color: 'emerald' };
  if (score >= 50) return { label: 'Fair', color: 'amber' };
  if (score >= 35) return { label: 'Needs work', color: 'orange' };
  return { label: 'Poor', color: 'red' };
}

/**
 * Portfolio-level target asset allocation + drift.
 *
 * Buckets every fund into one of: equity, debt, gold, other. Compares the
 * current weight (by current_value) to a user-configurable target and reports
 * drift in percentage points so the user can rebalance.
 *
 * Target weights persist in localStorage so the user only sets them once.
 */

import { isGoldFund } from './fundUtils';

const STORAGE_KEY = 'portfolio.targetAllocation.v1';

export const DEFAULT_TARGET = {
  equity: 60,
  debt: 30,
  gold: 5,
  other: 5,
};

export const BUCKET_LABELS = {
  equity: 'Equity',
  debt: 'Debt',
  gold: 'Gold',
  other: 'Other',
};

export const BUCKET_COLORS = {
  equity: { bar: 'bg-blue-500', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  debt: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  gold: { bar: 'bg-amber-500', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' },
  other: { bar: 'bg-gray-400', dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400' },
};

const EQUITY_TYPES = new Set(['stock', 'mutual_fund', 'private_share', 'esop']);
const DEBT_TYPES = new Set(['fd', 'ppf', 'epf']);

export function bucketForFund(fund) {
  if (!fund || !fund.type) return 'other';
  if (fund.type === 'gold') return 'gold';
  if (isGoldFund(fund.name) || isGoldFund(fund.symbol) || isGoldFund(fund.scheme_code)) {
    return 'gold';
  }
  if (EQUITY_TYPES.has(fund.type)) return 'equity';
  if (DEBT_TYPES.has(fund.type)) return 'debt';
  return 'other';
}

export function loadTarget() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TARGET };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TARGET, ...parsed };
  } catch {
    return { ...DEFAULT_TARGET };
  }
}

export function saveTarget(target) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(target));
}

export function isTargetValid(target) {
  const sum = Object.values(target).reduce((s, v) => s + (Number(v) || 0), 0);
  return Math.abs(sum - 100) < 0.01;
}

/**
 * Computes per-bucket actual weight + drift vs target.
 * Input: fund_metrics array as returned by the dashboard endpoint
 *        (each item has { fund, metrics: { current_value, current_units } }).
 * Output: { totalValue, buckets: { [name]: { value, actualPct, targetPct, drift } }, worstDrift }
 */
export function computeAllocationDrift(fundMetrics, target) {
  const tgt = target || loadTarget();
  const buckets = { equity: 0, debt: 0, gold: 0, other: 0 };
  let totalValue = 0;

  for (const fm of fundMetrics || []) {
    const value = fm?.metrics?.current_value || 0;
    if (value <= 0) continue;
    if ((fm?.metrics?.current_units || 0) <= 0 && !DEBT_TYPES.has(fm?.fund?.type)) continue;
    const b = bucketForFund(fm.fund);
    buckets[b] += value;
    totalValue += value;
  }

  const result = {};
  let worstDriftAbs = 0;
  let worstDriftBucket = null;

  for (const name of Object.keys(buckets)) {
    const value = buckets[name];
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0;
    const targetPct = Number(tgt[name]) || 0;
    const drift = actualPct - targetPct;
    if (Math.abs(drift) > worstDriftAbs) {
      worstDriftAbs = Math.abs(drift);
      worstDriftBucket = name;
    }
    result[name] = {
      value,
      actualPct: Math.round(actualPct * 10) / 10,
      targetPct,
      drift: Math.round(drift * 10) / 10,
    };
  }

  return {
    totalValue,
    buckets: result,
    worstDriftBucket,
    worstDriftAbs: Math.round(worstDriftAbs * 10) / 10,
  };
}

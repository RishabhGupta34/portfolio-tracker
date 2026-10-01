/**
 * ESOP / RSU helpers.
 *
 * Conventions:
 *  - The "fund" object's grant-level fields (`esop_grant_type`, `esop_company`,
 *    `esop_currency`) describe the grant as a whole.
 *  - Each `transaction` then represents either a VEST (RSU/ESOP becoming yours),
 *    an EXERCISE (paying strike for ESOPs), a BUY (e.g. cash purchase via
 *    purchase plan / ESPP), or a SELL.
 *  - Storage is always INR. The optional `original_*` fields preserve the
 *    foreign-currency inputs for audit, but `units`/`nav`/`amount` are INR.
 *
 * For a typical RSU lot:
 *    transaction_type = 'buy'
 *    strike_price     = 0
 *    nav              = FMV at vest (INR)        ← what's used for "current_nav" baseline
 *    fmv              = FMV at vest (INR)        ← preserved separately for clarity
 *    perquisite_tax   = TDS / withholding paid   (INR)
 *
 * For a typical ESOP exercise:
 *    transaction_type = 'buy'
 *    strike_price     = exercise price (INR)
 *    nav              = FMV at exercise (INR)
 *    fmv              = FMV at exercise (INR)
 *    perquisite_tax   = perq-tax paid on (FMV - strike) × units
 *
 * Cost basis = strike × units + tax paid     (per Indian tax law — taxed perq
 * is added to acquisition cost so it isn't double-taxed at sale).
 */

/**
 * True if the fund is an ESOP-type investment. Centralised so we don't sprinkle
 * the magic string everywhere.
 */
export function isEsop(fund) {
  return fund?.type === 'esop';
}

/**
 * Effective cost basis for a single ESOP/RSU buy transaction (INR).
 *  - For RSUs: strike = 0, so cost basis = perquisite tax paid (the part you
 *    effectively forfeited via TDS).
 *  - For ESOPs: cost basis = strike × units + perquisite tax.
 *
 * Falls back to `txn.amount` if ESOP-specific fields aren't present, so old
 * data continues to work unchanged.
 */
export function esopCostBasis(txn) {
  if (!txn) return 0;
  if (txn.strike_price == null && txn.perquisite_tax == null && txn.fmv == null) {
    // Plain transaction — use the existing amount field
    return txn.amount || 0;
  }
  const strikeCost = (txn.strike_price ?? 0) * (txn.units ?? 0);
  const tax = txn.perquisite_tax ?? 0;
  return Math.round((strikeCost + tax) * 100) / 100;
}

/**
 * "Out-of-pocket" amount for a single ESOP transaction (INR).
 * For RSUs this is just the perquisite tax paid; for ESOPs it's strike + tax.
 * Used in the UI to show "what this cost you cash-wise" without double-counting
 * the FMV (which represents notional value, not money spent).
 */
export function esopOutOfPocket(txn) {
  if (!txn) return 0;
  if (txn.strike_price == null && txn.perquisite_tax == null) {
    return txn.amount || 0;
  }
  return esopCostBasis(txn);
}

/**
 * Aggregate ESOP-level summary for a fund. Returns null for non-ESOP funds so
 * the caller can early-out.
 */
export function summarizeEsopFund(fund) {
  if (!isEsop(fund)) return null;

  let totalUnits = 0;
  let totalCostBasis = 0;
  let totalOutOfPocket = 0;
  let totalTaxPaid = 0;
  let totalStrikePaid = 0;
  let totalFmvAtVest = 0; // notional "received" value (sum of FMV × units at the vest date)

  for (const txn of fund.transactions || []) {
    const isBuy = txn.transaction_type === 'buy' || txn.transaction_type === 'bonus' || txn.transaction_type === 'vest';
    if (isBuy) {
      totalUnits += txn.units || 0;
      totalCostBasis += esopCostBasis(txn);
      totalOutOfPocket += esopOutOfPocket(txn);
      totalTaxPaid += txn.perquisite_tax || 0;
      totalStrikePaid += (txn.strike_price ?? 0) * (txn.units || 0);
      const fmv = txn.fmv ?? txn.nav ?? 0;
      totalFmvAtVest += fmv * (txn.units || 0);
    } else if (txn.transaction_type === 'sell') {
      // For sell, we draw down cost basis pro-rata (handled in realized-gains FIFO).
      // Here we just decrement unit count for the "current holding" summary.
      const ratio = totalUnits > 0 ? Math.min(1, (txn.units || 0) / totalUnits) : 0;
      const drawnCost = totalCostBasis * ratio;
      const drawnOoP = totalOutOfPocket * ratio;
      const drawnTax = totalTaxPaid * ratio;
      const drawnStrike = totalStrikePaid * ratio;
      const drawnFmv = totalFmvAtVest * ratio;
      totalUnits -= txn.units || 0;
      totalCostBasis -= drawnCost;
      totalOutOfPocket -= drawnOoP;
      totalTaxPaid -= drawnTax;
      totalStrikePaid -= drawnStrike;
      totalFmvAtVest -= drawnFmv;
    }
  }

  const currentFmv = fund.current_nav || 0;
  const currentValue = totalUnits > 0 ? currentFmv * totalUnits : 0;

  // Net gain vs the perq-tax-inclusive cost basis (what you actually "paid").
  const netGain = currentValue - totalCostBasis;
  const netGainPct = totalCostBasis > 0 ? (netGain / totalCostBasis) * 100 : 0;

  // Pre-tax notional gain since vest — useful for "how much my equity has appreciated".
  const appreciationSinceVest = currentValue - totalFmvAtVest;
  const appreciationPct = totalFmvAtVest > 0 ? (appreciationSinceVest / totalFmvAtVest) * 100 : 0;

  return {
    grantType: fund.esop_grant_type || 'esop',
    company: fund.esop_company || null,
    currency: fund.esop_currency || 'INR',
    totalUnits: Math.round(totalUnits * 10000) / 10000,
    totalCostBasis: Math.round(totalCostBasis * 100) / 100,
    totalOutOfPocket: Math.round(totalOutOfPocket * 100) / 100,
    totalTaxPaid: Math.round(totalTaxPaid * 100) / 100,
    totalStrikePaid: Math.round(totalStrikePaid * 100) / 100,
    totalFmvAtVest: Math.round(totalFmvAtVest * 100) / 100,
    currentFmv: Math.round(currentFmv * 100) / 100,
    currentValue: Math.round(currentValue * 100) / 100,
    netGain: Math.round(netGain * 100) / 100,
    netGainPct: Math.round(netGainPct * 100) / 100,
    appreciationSinceVest: Math.round(appreciationSinceVest * 100) / 100,
    appreciationPct: Math.round(appreciationPct * 100) / 100,
  };
}

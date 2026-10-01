/**
 * Reusable ESOP / RSU transaction sub-form.
 *
 * Renders the strike-price / FMV / perquisite-tax / currency inputs and handles
 * on-demand FX conversion via `getFxRate`. The parent form owns the state — this
 * component just renders the fields and emits onChange events.
 *
 * Storage contract (consumer side): when the user submits, the parent should
 * convert all monetary fields to INR using the most recent fx_rate from this
 * component, send those INR values as `nav`, `strike_price`, `fmv`,
 * `perquisite_tax`, and pass the originals as `original_*` + `fx_rate` +
 * `fx_rate_source` for audit. See `prepareEsopTxnForApi` below for the helper.
 */

import { useState } from 'react';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { toast } from './ui/Toast';
import { RefreshCw, Banknote } from 'lucide-react';
import { SUPPORTED_CURRENCIES, getFxRate, formatFxRate } from '../lib/fxRates';
import { formatCurrency } from '../lib/utils';

export function EsopFields({ value, onChange, grantType = 'rsu', units = null }) {
  const [fetchingFx, setFetchingFx] = useState(false);
  const [fxRateInfo, setFxRateInfo] = useState(null);

  const isRsu = grantType === 'rsu';
  const currency = value.original_currency || 'INR';
  const isForeign = currency && currency !== 'INR';

  // Tax input mode: 'amount' (INR) or 'percent' (% of perquisite value)
  const taxMode = value.tax_input_type || 'amount';

  // Perquisite base value (FMV - strike) × units for percent-to-INR calculation
  const fx = value.fx_rate || (currency === 'INR' ? 1 : null);
  const fmvInr = value.original_fmv != null && fx ? value.original_fmv * fx : null;
  const strikeInr = value.original_strike_price != null && fx ? value.original_strike_price * fx : 0;
  const perqBasePerUnit = fmvInr != null ? Math.max(0, fmvInr - strikeInr) : null;
  const perqBaseTotal = perqBasePerUnit != null && units != null && units > 0
    ? perqBasePerUnit * units
    : perqBasePerUnit;

  const handleTaxChange = (rawVal, mode) => {
    const parsed = rawVal !== '' ? parseFloat(rawVal) : null;
    let taxInr = null;
    if (parsed != null) {
      if (mode === 'percent' && perqBaseTotal != null) {
        taxInr = (parsed / 100) * perqBaseTotal;
      } else if (mode === 'amount') {
        taxInr = parsed;
      }
    }
    onChange({
      ...value,
      tax_input_type: mode,
      tax_input_value: parsed,
      perquisite_tax: taxInr != null ? Math.round(taxInr * 100) / 100 : null,
    });
  };

  const handleTaxModeSwitch = (newMode) => {
    // Convert existing value to the new mode
    const currentTax = value.perquisite_tax;
    let newInputVal = null;
    if (currentTax != null) {
      if (newMode === 'percent' && perqBaseTotal != null && perqBaseTotal > 0) {
        newInputVal = Math.round((currentTax / perqBaseTotal) * 10000) / 100;
      } else if (newMode === 'amount') {
        newInputVal = currentTax;
      }
    }
    onChange({
      ...value,
      tax_input_type: newMode,
      tax_input_value: newInputVal,
    });
  };

  const handleFetchFx = async () => {
    if (currency === 'INR') return;
    setFetchingFx(true);
    try {
      const result = await getFxRate(currency, 'INR');
      if (result?.rate) {
        setFxRateInfo(result);
        onChange({ ...value, fx_rate: result.rate, fx_rate_source: result.source });
        toast.success(`Fetched: ${formatFxRate(result, currency)}`);
      } else {
        toast.error(`Could not fetch ${currency}/INR rate`);
      }
    } catch (e) {
      toast.error('FX fetch failed: ' + (e.message || ''));
    } finally {
      setFetchingFx(false);
    }
  };

  const previewInr = (n) => {
    const x = parseFloat(n);
    if (!Number.isFinite(x) || !fx) return null;
    return x * fx;
  };

  return (
    <div className="space-y-3 p-3 rounded-lg border border-dashed border-purple-300 bg-purple-50/40 dark:bg-purple-950/20">
      <div className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
        <Banknote className="h-3.5 w-3.5" />
        {isRsu ? 'RSU' : 'ESOP'} Details
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium mb-1">Currency</label>
          <select
            value={currency}
            onChange={(e) => onChange({ ...value, original_currency: e.target.value, fx_rate: e.target.value === 'INR' ? 1 : null })}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            {SUPPORTED_CURRENCIES.map(c => (<option key={c} value={c}>{c}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">FX Rate (1 {currency} → INR)</label>
          <div className="flex gap-1">
            <Input
              type="number"
              step="0.0001"
              value={value.fx_rate ?? ''}
              onChange={(e) => onChange({ ...value, fx_rate: e.target.value ? parseFloat(e.target.value) : null, fx_rate_source: 'manual' })}
              placeholder={currency === 'INR' ? '1' : 'Click ↻'}
              disabled={currency === 'INR'}
              className="h-9 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleFetchFx}
              disabled={currency === 'INR' || fetchingFx}
              title={`Fetch live ${currency}/INR rate`}
              className="h-9 w-9 shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetchingFx ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          {fxRateInfo && (
            <div className="text-[10px] text-muted-foreground mt-0.5">{formatFxRate(fxRateInfo, currency)}</div>
          )}
        </div>
      </div>

      {!isRsu && (
        <div>
          <label className="block text-xs font-medium mb-1">
            Strike / Exercise Price (per share, {currency})
          </label>
          <Input
            type="number"
            step="0.0001"
            value={value.original_strike_price ?? ''}
            onChange={(e) => onChange({ ...value, original_strike_price: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder="e.g., 25.00"
            className="h-9 text-sm"
          />
          {isForeign && fx && previewInr(value.original_strike_price) != null && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              ≈ {formatCurrency(previewInr(value.original_strike_price))} per share
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium mb-1">
          FMV at Vest / Exercise (per share, {currency})
        </label>
        <Input
          type="number"
          step="0.0001"
          value={value.original_fmv ?? ''}
          onChange={(e) => onChange({ ...value, original_fmv: e.target.value ? parseFloat(e.target.value) : null })}
          placeholder="e.g., 180.50"
          className="h-9 text-sm"
        />
        {isForeign && fx && previewInr(value.original_fmv) != null && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            ≈ {formatCurrency(previewInr(value.original_fmv))} per share
          </div>
        )}
      </div>

      {/* Tax paid — toggle between INR amount and % of perquisite value */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium">Tax Paid (TDS / Perquisite)</label>
          <div className="flex rounded-md border border-input overflow-hidden text-[10px]">
            <button
              type="button"
              onClick={() => handleTaxModeSwitch('amount')}
              className={`px-2 py-0.5 transition-colors ${taxMode === 'amount' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
            >
              ₹ Amount
            </button>
            <button
              type="button"
              onClick={() => handleTaxModeSwitch('percent')}
              className={`px-2 py-0.5 transition-colors ${taxMode === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
            >
              % Rate
            </button>
          </div>
        </div>
        <Input
          type="number"
          step={taxMode === 'percent' ? '0.01' : '1'}
          value={taxMode === 'percent'
            ? (value.tax_input_value ?? (value.perquisite_tax != null && perqBaseTotal != null && perqBaseTotal > 0 ? Math.round(value.perquisite_tax / perqBaseTotal * 10000) / 100 : ''))
            : (value.tax_input_value ?? value.perquisite_tax ?? '')}
          onChange={(e) => handleTaxChange(e.target.value, taxMode)}
          placeholder={taxMode === 'percent' ? 'e.g., 30 (%)' : 'e.g., 25000 (₹)'}
          className="h-9 text-sm"
        />
        {taxMode === 'percent' && perqBaseTotal != null && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Perquisite base: {formatCurrency(perqBaseTotal)}{units != null && units > 0 ? ` (${perqBasePerUnit != null ? '₹' + perqBasePerUnit.toFixed(2) + '/share × ' + units + ' units' : ''})` : ''}
          </div>
        )}
        {taxMode === 'percent' && value.perquisite_tax != null && (
          <div className="text-[10px] text-green-600 mt-0.5">
            = {formatCurrency(value.perquisite_tax)} INR
          </div>
        )}
        {taxMode === 'amount' && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Indian TDS is in INR. Becomes part of your cost basis on sale.
          </div>
        )}
        {taxMode === 'percent' && perqBaseTotal == null && (
          <div className="text-[10px] text-amber-600 mt-0.5">
            Enter FMV (and strike for ESOP) first to calculate INR amount.
          </div>
        )}
      </div>

      {/* Estimated / IPO price — visualization only */}
      <div>
        <label className="block text-xs font-medium mb-1">
          Estimated / IPO Price (per share, {currency}) — optional
        </label>
        <Input
          type="number"
          step="0.0001"
          value={value.original_estimated_price ?? ''}
          onChange={(e) => {
            const v = e.target.value ? parseFloat(e.target.value) : null;
            onChange({
              ...value,
              original_estimated_price: v,
              estimated_price: v != null && fx ? Math.round(v * fx * 100) / 100 : null,
            });
          }}
          placeholder="e.g., 250.00 (pre-IPO / target)"
          className="h-9 text-sm"
        />
        {isForeign && fx && value.original_estimated_price != null && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            ≈ {formatCurrency(previewInr(value.original_estimated_price))} per share
          </div>
        )}
        {value.original_estimated_price != null && (value.original_fmv != null || value.original_strike_price != null) && (
          <div className="text-[10px] text-purple-600 mt-0.5">
            {(() => {
              const estInr = value.original_estimated_price != null && fx ? value.original_estimated_price * fx : null;
              const fmv = value.original_fmv != null && fx ? value.original_fmv * fx : null;
              if (estInr != null && fmv != null && fmv > 0) {
                const upside = ((estInr - fmv) / fmv) * 100;
                return `Potential upside vs FMV: ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`;
              }
              return null;
            })()}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-0.5">
          For display only — does not affect calculations
        </div>
      </div>
    </div>
  );
}

/**
 * Helper for the parent form's submit handler.
 *
 * Given the raw ESOP field state, produces the INR-normalised payload to send to
 * `addTransaction`. Returns null if the FX rate isn't available for a foreign-
 * currency entry (caller should toast and abort).
 */
export function prepareEsopTxnForApi(units, esopFields) {
  const {
    original_currency: cur,
    original_strike_price,
    original_fmv,
    original_estimated_price,
    fx_rate,
    fx_rate_source,
    perquisite_tax,
    tax_input_type,
    tax_input_value,
  } = esopFields || {};

  const isForeign = cur && cur !== 'INR';
  const rate = isForeign ? fx_rate : 1;

  if (isForeign && !rate) {
    return { error: `FX rate for ${cur}/INR is missing. Click the refresh icon to fetch it.` };
  }

  const strikeInr = original_strike_price != null ? original_strike_price * rate : 0;
  const fmvInr = original_fmv != null ? original_fmv * rate : 0;

  // nav for the transaction = FMV at vest (the "received" price). This makes
  // calculations.js' baseline behaviour (current_value = current_nav × units)
  // remain meaningful for ESOP entries.
  const nav = Math.round(fmvInr * 100) / 100;
  const amount = Math.round(nav * (units || 0) * 100) / 100;

  const estInr = original_estimated_price != null ? Math.round(original_estimated_price * rate * 100) / 100 : null;

  return {
    nav,
    amount,
    strike_price: Math.round(strikeInr * 100) / 100,
    fmv: Math.round(fmvInr * 100) / 100,
    perquisite_tax: perquisite_tax != null ? Math.round(perquisite_tax * 100) / 100 : null,
    original_currency: cur || 'INR',
    original_nav: original_fmv ?? null,
    original_strike_price: original_strike_price ?? null,
    original_fmv: original_fmv ?? null,
    fx_rate: isForeign ? rate : 1,
    fx_rate_source: isForeign ? (fx_rate_source || 'unknown') : 'identity',
    estimated_price: estInr,
    original_estimated_price: original_estimated_price ?? null,
    tax_input_type: tax_input_type ?? 'amount',
    tax_input_value: tax_input_value ?? null,
  };
}

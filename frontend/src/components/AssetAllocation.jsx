import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { formatCurrency, formatNumber } from '../lib/utils';
import {
  computeAllocationDrift,
  loadTarget,
  saveTarget,
  isTargetValid,
  BUCKET_LABELS,
  BUCKET_COLORS,
  DEFAULT_TARGET,
} from '../lib/targetAllocation';
import { Settings, AlertCircle, Check } from 'lucide-react';

const BUCKET_ORDER = ['equity', 'debt', 'gold', 'other'];

export function AssetAllocation({ fundMetrics, hideValues }) {
  const [target, setTargetState] = useState(() => loadTarget());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => loadTarget());

  const allocation = useMemo(
    () => computeAllocationDrift(fundMetrics, target),
    [fundMetrics, target]
  );

  if (!fundMetrics || allocation.totalValue <= 0) {
    return null;
  }

  const draftSum = BUCKET_ORDER.reduce((s, b) => s + (Number(draft[b]) || 0), 0);
  const draftValid = isTargetValid(draft);

  const openEdit = () => {
    setDraft({ ...target });
    setEditing(true);
  };

  const save = () => {
    if (!draftValid) return;
    const normalized = BUCKET_ORDER.reduce((acc, b) => {
      acc[b] = Number(draft[b]) || 0;
      return acc;
    }, {});
    saveTarget(normalized);
    setTargetState(normalized);
    setEditing(false);
  };

  const resetDefault = () => setDraft({ ...DEFAULT_TARGET });

  const worstBucket = allocation.worstDriftBucket;
  const worst = worstBucket ? allocation.buckets[worstBucket] : null;
  const driftThreshold = 5;
  const showAlert = worst && Math.abs(worst.drift) >= driftThreshold;

  return (
    <Card data-report-capture="allocation">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-lg">Target Allocation</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Actual mix vs. your target across asset classes
          </p>
        </div>
        <button
          onClick={openEdit}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          title="Edit target"
        >
          <Settings className="h-4 w-4 text-muted-foreground" />
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        <StackedBar buckets={allocation.buckets} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {BUCKET_ORDER.map((name) => {
            const b = allocation.buckets[name];
            const colors = BUCKET_COLORS[name];
            const drift = b.drift;
            const driftSign = drift > 0 ? '+' : '';
            const driftColor =
              Math.abs(drift) < 1
                ? 'text-muted-foreground'
                : drift > 0
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-blue-600 dark:text-blue-400';
            return (
              <div key={name} className="p-3 rounded-lg bg-muted/30 border border-muted/50">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                  <span className="text-xs font-medium">{BUCKET_LABELS[name]}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <div className={`text-lg font-bold ${colors.text}`}>
                    {formatNumber(b.actualPct, 1)}%
                  </div>
                  <div className="text-xs text-muted-foreground">
                    target {b.targetPct}%
                  </div>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <div className="text-xs text-muted-foreground">
                    {hideValues ? '••' : formatCurrency(b.value)}
                  </div>
                  <div className={`text-xs font-semibold ${driftColor}`}>
                    {Math.abs(drift) < 0.05 ? '0.0pp' : `${driftSign}${formatNumber(drift, 1)}pp`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {showAlert && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              {BUCKET_LABELS[worstBucket]} is{' '}
              <strong>{formatNumber(Math.abs(worst.drift), 1)}pp {worst.drift > 0 ? 'over' : 'under'}</strong>{' '}
              the {worst.targetPct}% target — consider rebalancing.
            </span>
          </div>
        )}
      </CardContent>

      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title="Set Target Allocation"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set the percentage you want in each bucket. Must total 100%.
          </p>

          <div className="space-y-3">
            {BUCKET_ORDER.map((name) => (
              <div key={name} className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full ${BUCKET_COLORS[name].dot}`} />
                <label className="text-sm font-medium w-20">{BUCKET_LABELS[name]}</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft[name]}
                  onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-4">%</span>
              </div>
            ))}
          </div>

          <div className={`p-2 rounded text-xs flex items-center gap-2 ${
            draftValid
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }`}>
            {draftValid ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            <span>
              {draftValid ? 'Totals 100%' : `Currently ${formatNumber(draftSum, 1)}% — must equal 100%`}
            </span>
          </div>

          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={resetDefault}>
              Reset to default
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={!draftValid}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function StackedBar({ buckets }) {
  const segs = BUCKET_ORDER.filter((n) => buckets[n].actualPct > 0);
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden">
        {segs.map((name) => (
          <div
            key={name}
            className={BUCKET_COLORS[name].bar}
            style={{ width: `${buckets[name].actualPct}%` }}
            title={`${BUCKET_LABELS[name]} ${formatNumber(buckets[name].actualPct, 1)}%`}
          />
        ))}
      </div>
      <div className="flex h-1 mt-1 rounded-full overflow-hidden bg-muted/40">
        {BUCKET_ORDER.filter((n) => buckets[n].targetPct > 0).map((name) => (
          <div
            key={name}
            className={`${BUCKET_COLORS[name].bar} opacity-40`}
            style={{ width: `${buckets[name].targetPct}%` }}
            title={`Target ${BUCKET_LABELS[name]} ${buckets[name].targetPct}%`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Actual</span>
        <span>Target (faded)</span>
      </div>
    </div>
  );
}

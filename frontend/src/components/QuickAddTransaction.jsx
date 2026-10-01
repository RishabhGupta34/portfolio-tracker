import { useEffect, useMemo, useState } from 'react';
import { portfolioApi } from '../lib/api';
import { Plus, X, Search } from 'lucide-react';
import { toast } from './ui/Toast';
import { Button } from './ui/Button';

export function QuickAddTransaction({ buttonClassName }) {
  const [open, setOpen] = useState(false);
  const [funds, setFunds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedFundId, setSelectedFundId] = useState(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    transaction_type: 'buy',
    units: '',
    nav: '',
    notes: '',
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [fundsRes, accountsRes] = await Promise.all([
          portfolioApi.getFunds(),
          portfolioApi.getAccounts(),
        ]);
        if (cancelled) return;
        setFunds(fundsRes.data || []);
        setAccounts(accountsRes.data || []);
      } catch (e) {
        toast.error?.('Failed to load funds');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Lock body scroll while the modal is open so iOS WKWebView can't shift
  // our fixed-positioned overlay (a known quirk where `position: fixed`
  // misaligns when the page underneath has a non-zero scroll offset).
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.width = '';
      document.body.style.top = '';
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const accountById = useMemo(() => {
    const map = {};
    for (const a of accounts) map[a.id] = a;
    return map;
  }, [accounts]);

  const filteredFunds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = funds.filter((f) => !['fd', 'ppf', 'epf'].includes(f.type));
    if (!q) return list;
    return list.filter((f) => f.name.toLowerCase().includes(q));
  }, [funds, search]);

  const selectedFund = funds.find((f) => f.id === selectedFundId) || null;

  const reset = () => {
    setOpen(false);
    setSelectedFundId(null);
    setSearch('');
    setForm({
      date: new Date().toISOString().split('T')[0],
      transaction_type: 'buy',
      units: '',
      nav: '',
      notes: '',
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFund) return;
    const units = parseFloat(form.units);
    const nav = form.transaction_type === 'split' ? 0 : parseFloat(form.nav);
    if (!isFinite(units) || units <= 0) {
      toast.error?.('Enter valid units');
      return;
    }
    if (form.transaction_type !== 'split' && (!isFinite(nav) || nav <= 0)) {
      toast.error?.('Enter valid NAV / price');
      return;
    }
    setSubmitting(true);
    try {
      await portfolioApi.addTransaction({
        fund_id: selectedFund.id,
        date: form.date,
        units,
        nav,
        amount: units * nav,
        transaction_type: form.transaction_type,
        notes: form.notes || undefined,
      });
      toast.success?.('Transaction added');
      reset();
    } catch (err) {
      console.error(err);
      toast.error?.('Failed to add transaction');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className={buttonClassName || 'rounded-full'}
        aria-label="Add transaction"
        title="Add transaction"
      >
        <Plus className="h-5 w-5" />
      </Button>

      {open && (
        <div
          // Backdrop covers entire viewport including under-status-bar.
          // Card is absolutely positioned below it with hardcoded offsets —
          // this avoids iOS WKWebView quirks with flex centering + fixed
          // positioning + nested calc/env CSS functions.
          className="fixed inset-0 z-[60] bg-black/50"
          onClick={reset}
        >
          <div
            className="absolute left-1/2 -translate-x-1/2 bg-card border border-border rounded-xl shadow-2xl w-[calc(100%-2rem)] max-w-md overflow-hidden flex flex-col"
            style={{
              // 6rem = system status bar (~20-44px) + app header (h-16 = 4rem) + breathing room
              top: '6rem',
              maxHeight: 'calc(100dvh - 8rem)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-semibold">
                {selectedFund ? selectedFund.name : 'Add Transaction'}
              </h3>
              <button onClick={reset} className="p-1 rounded hover:bg-muted">
                <X className="h-5 w-5" />
              </button>
            </div>

            {!selectedFund ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="p-3 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      autoFocus
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search funds, stocks..."
                      className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
                  ) : filteredFunds.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No funds found. Add one from the Investments tab first.
                    </div>
                  ) : (
                    <ul>
                      {filteredFunds.map((f) => (
                        <li key={f.id}>
                          <button
                            onClick={() => {
                              setSelectedFundId(f.id);
                              setForm((s) => ({
                                ...s,
                                nav: f.current_nav ? String(f.current_nav) : '',
                              }));
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-muted/60 border-b border-border/40"
                          >
                            <div className="text-sm font-medium truncate">{f.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {accountById[f.account_id]?.name || '—'} · {f.type}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-4 space-y-3 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => setSelectedFundId(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Pick a different fund
                </button>

                <div>
                  <label className="text-xs text-muted-foreground">Type</label>
                  <select
                    value={form.transaction_type}
                    onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                    <option value="bonus">Bonus</option>
                    <option value="split">Split</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Units</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={form.units}
                      onChange={(e) => setForm({ ...form, units: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {form.transaction_type === 'split' ? 'NAV (n/a)' : 'NAV / Price'}
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      value={form.nav}
                      disabled={form.transaction_type === 'split'}
                      onChange={(e) => setForm({ ...form, nav: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      required={form.transaction_type !== 'split'}
                    />
                  </div>
                </div>

                {form.units && form.nav && form.transaction_type !== 'split' && (
                  <div className="text-xs text-muted-foreground">
                    Amount: ₹{(parseFloat(form.units) * parseFloat(form.nav)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

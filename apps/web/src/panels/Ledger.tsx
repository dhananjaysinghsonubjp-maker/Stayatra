import { useEffect, useState } from 'react';
import { query, mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, EmptyState, Field, PageHeader, StatCard, Toggle, inputClass } from '../components/ui';
import { PAYMENT_METHODS, paymentMethodLabel } from '../paymentMethods';
import { formatDateTimeShort } from '../dateFormat';
import type { LedgerCategory, LedgerSummary, LedgerTransaction, PaymentMethod } from '../types';

/**
 * §user request — "Ledger / Chart of Accounts": every cash movement at the hotel, not just
 * per-booking payments. Guest payments (bookings.addPayment) show up here automatically, tagged
 * "Room" — nothing to log twice. Everything else (utility bills, payroll, supplies) gets logged
 * here directly as a Cash In/Cash Out entry. Petty cash is just a tag on an entry, not a separate
 * fund, so its balance is a sub-total of the same transactions, not a second ledger.
 */
export function Ledger({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [entryModal, setEntryModal] = useState<'cash_in' | 'cash_out' | null>(null);
  const canManage = ['owner', 'manager'].includes(role('pms') ?? '');
  const canLogEntry = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    try {
      const [s, t, c] = await Promise.all([
        query<LedgerSummary>('ledger.getSummary', { hotelId }, token ?? undefined),
        query<LedgerTransaction[]>('ledger.listTransactions', { hotelId }, token ?? undefined),
        query<LedgerCategory[]>('ledger.listCategories', { hotelId }, token ?? undefined),
      ]);
      setSummary(s);
      setTransactions(t);
      setCategories(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ledger');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function deleteEntry(id: string) {
    if (!confirm('Delete this ledger entry? This cannot be undone.')) return;
    try {
      await mutate('ledger.deleteEntry', { entryId: id }, token ?? undefined);
      void refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete entry');
    }
  }

  return (
    <div>
      <PageHeader title="Ledger" subtitle="Every cash movement — guest payments, plus whatever the hotel logs itself." />

      {summary && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Balance" value={`₹${summary.balance.toLocaleString('en-IN')}`} tone="brand" />
            <StatCard label="Cash In" value={`₹${summary.cashIn.toLocaleString('en-IN')}`} />
            <StatCard label="Cash Out" value={`₹${summary.cashOut.toLocaleString('en-IN')}`} tone="amber" />
            <StatCard label="Petty Cash" value={`₹${summary.pettyCashBalance.toLocaleString('en-IN')}`} />
          </div>
          {Object.keys(summary.byMode).length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {Object.entries(summary.byMode).map(([mode, amt]) => (
                <span key={mode} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {paymentMethodLabel(mode as PaymentMethod)}: ₹{(amt ?? 0).toLocaleString('en-IN')}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {canLogEntry && (
        <div className="mb-4 flex gap-2">
          <Button type="button" onClick={() => setEntryModal('cash_in')}>
            + Cash In
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEntryModal('cash_out')}>
            + Cash Out
          </Button>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Card>
        {transactions.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No transactions yet" hint="Guest payments and anything you log here will show up." />
          </div>
        ) : (
          // whitespace-nowrap on every cell, same fix as RoomBoard's table — without it a
          // narrow viewport wraps the date/badge/amount onto 2-3 lines each instead of just
          // scrolling the table horizontally.
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Remarks</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {transactions.map((t) => (
                  <tr key={`${t.kind}-${t.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{formatDateTimeShort(t.createdAt)}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          t.type === 'cash_in'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                      >
                        {t.type === 'cash_in' ? 'Cash In' : 'Cash Out'}
                      </span>
                      {t.isPettyCash && <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">· petty</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-700 dark:text-slate-300">{t.category ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{paymentMethodLabel(t.paymentMethod)}</td>
                    <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{t.kind === 'payment' ? `Guest payment — ${t.guestName}` : t.remarks || '—'}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${t.type === 'cash_in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {t.type === 'cash_in' ? '+' : '−'}₹{t.amount.toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.kind === 'ledger' && canManage && (
                        <button onClick={() => void deleteEntry(t.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {entryModal && <LedgerEntryModal hotelId={hotelId} type={entryModal} categories={categories} onClose={() => setEntryModal(null)} onDone={refresh} />}
    </div>
  );
}

function LedgerEntryModal({
  hotelId,
  type,
  categories,
  onClose,
  onDone,
}: {
  hotelId: string;
  type: 'cash_in' | 'cash_out';
  categories: LedgerCategory[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [categoryId, setCategoryId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [isPettyCash, setIsPettyCash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topLevelCategories = categories.filter((c) => !c.parentId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || amount <= 0) {
      setError('Enter an amount');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mutate(
        'ledger.createEntry',
        { hotelId, type, amount, paymentMethod: method, categoryId: categoryId || undefined, remarks: remarks || undefined, isPettyCash },
        token ?? undefined,
      );
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4">
      <Card className="w-full max-w-md p-5">
        <h4 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">{type === 'cash_in' ? 'Cash In' : 'Cash Out'}</h4>
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Amount (₹)">
            <input
              className={inputClass}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
              min={1}
              autoFocus
            />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Method</p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                    method === m.value
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600 dark:hover:bg-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Category (optional)">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">— None —</option>
              {topLevelCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Remarks (optional)">
            <input className={inputClass} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Electricity bill — October" />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-600">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">Petty cash</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Counts toward the petty-cash sub-total, not a separate fund.</p>
            </div>
            <Toggle checked={isPettyCash} onChange={setIsPettyCash} />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

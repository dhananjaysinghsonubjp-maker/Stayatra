import { useState } from 'react';
import { Button, Field, inputClass } from '../components/ui';
import { StepTabs } from './ListingWizardTabs';

export interface FinanceInfo {
  gstRegistration: string;
  panNumber: string;
  bankAccountHolderName: string;
  bankAccountNumber: string;
  bankIfsc: string;
}

export function FinanceAndLegalStep({
  initial,
  onContinue,
  onBack,
  busy = false,
  serverError = null,
}: {
  initial?: Partial<FinanceInfo>;
  onContinue: (info: FinanceInfo) => void;
  onBack: () => void;
  busy?: boolean;
  serverError?: string | null;
}) {
  const [gstRegistration, setGstRegistration] = useState(initial?.gstRegistration ?? '');
  const [panNumber, setPanNumber] = useState(initial?.panNumber ?? '');
  const [bankAccountHolderName, setBankAccountHolderName] = useState(initial?.bankAccountHolderName ?? '');
  const [bankAccountNumber, setBankAccountNumber] = useState(initial?.bankAccountNumber ?? '');
  const [bankIfsc, setBankIfsc] = useState(initial?.bankIfsc ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onContinue({ gstRegistration, panNumber, bankAccountHolderName, bankAccountNumber, bankIfsc });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <StepTabs current={7} />
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl flex-1 px-10 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Finance &amp; Legal</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
          Everything here is optional for now — OTA payouts aren't live yet, but adding these once saves you a trip later.
        </p>

        <div className="mb-6 rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Legal <span className="font-normal text-slate-400">(optional)</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-6 px-6 py-5">
            <Field label="GST Registration Number">
              <input className={inputClass} value={gstRegistration} onChange={(e) => setGstRegistration(e.target.value)} placeholder="e.g. 22AAAAA0000A1Z5" />
            </Field>
            <Field label="PAN Number">
              <input className={inputClass} value={panNumber} onChange={(e) => setPanNumber(e.target.value)} placeholder="e.g. AAAAA0000A" />
            </Field>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Bank Account for Payouts <span className="font-normal text-slate-400">(optional)</span>
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Used later once OTA bookings & payouts are connected.</p>
          </div>
          <div className="grid grid-cols-2 gap-6 px-6 py-5">
            <Field label="Account Holder Name">
              <input className={inputClass} value={bankAccountHolderName} onChange={(e) => setBankAccountHolderName(e.target.value)} />
            </Field>
            <Field label="Account Number">
              <input className={inputClass} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
            </Field>
            <Field label="IFSC Code">
              <input className={inputClass} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="e.g. HDFC0001234" />
            </Field>
          </div>
        </div>

        {serverError && <p className="mb-4 text-sm text-red-600">{serverError}</p>}

        <div className="flex items-center justify-between pb-8">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            ← Back
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Finish Listing'}
          </Button>
        </div>
      </form>
    </div>
  );
}

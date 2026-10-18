import { useState } from 'react';
import { Button, inputClass } from '../components/ui';
import { StepTabs } from './ListingWizardTabs';

export interface BasicInfo {
  name: string;
  starRating: number | null;
  builtYear: number | null;
  acceptingBookingsSince: number | null;
  contactEmail: string;
  contactMobile: string;
  contactMobileIsWhatsapp: boolean;
  contactLandline: string;
  dpdpConsent: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1950 + 1 }, (_, i) => CURRENT_YEAR - i);

function VerifyField({
  value,
  onChange,
  placeholder,
  prefix,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  prefix?: string;
  type?: string;
}) {
  const [verified, setVerified] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
      {prefix && <span className="shrink-0 text-sm text-slate-500">{prefix}</span>}
      <input
        type={type}
        className="min-w-0 flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setVerified(false);
        }}
        placeholder={placeholder}
      />
      {verified ? (
        <span className="shrink-0 text-xs font-medium text-emerald-600">✓ Verified</span>
      ) : (
        <button
          type="button"
          disabled={!value.trim()}
          onClick={() => setVerified(true)}
          className="shrink-0 text-xs font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
        >
          Verify
        </button>
      )}
    </div>
  );
}

export function BasicInfoStep({
  initial,
  onContinue,
  onBack,
  busy = false,
  serverError = null,
}: {
  initial?: Partial<BasicInfo>;
  onContinue: (info: BasicInfo) => void;
  onBack: () => void;
  /** Driven by the parent while it awaits the hotel-creation call this step's submit now triggers. */
  busy?: boolean;
  serverError?: string | null;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [starRating, setStarRating] = useState(initial?.starRating ?? null);
  const [builtYear, setBuiltYear] = useState(initial?.builtYear ?? null);
  const [acceptingBookingsSince, setAcceptingBookingsSince] = useState(initial?.acceptingBookingsSince ?? null);
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [contactMobile, setContactMobile] = useState(initial?.contactMobile ?? '');
  const [contactMobileIsWhatsapp, setContactMobileIsWhatsapp] = useState(initial?.contactMobileIsWhatsapp ?? false);
  const [contactLandline, setContactLandline] = useState(initial?.contactLandline ?? '');
  const [dpdpConsent, setDpdpConsent] = useState(initial?.dpdpConsent ?? false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter the name of the property to continue.');
      return;
    }
    if (!dpdpConsent) {
      setError('Please accept the data-processing consent to continue.');
      return;
    }
    setError(null);
    onContinue({
      name: name.trim(),
      starRating,
      builtYear,
      acceptingBookingsSince,
      contactEmail: contactEmail.trim(),
      contactMobile: contactMobile.trim(),
      contactMobileIsWhatsapp,
      contactLandline: contactLandline.trim(),
      dpdpConsent,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <StepTabs current={2} />
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl flex-1 px-10 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Basic Info</h1>

        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Property Details</h2>
            <p className="mt-0.5 text-sm text-slate-500">Update your property details here</p>
          </div>

          <div className="divide-y divide-slate-100 px-6">
            <div className="grid grid-cols-2 items-center gap-6 py-5">
              <div>
                <p className="text-sm font-semibold text-slate-900">Name of the Property</p>
                <p className="mt-0.5 text-xs text-slate-500">Enter the name as on the property documents</p>
              </div>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter the full name"
                required
              />
            </div>

            <div className="grid grid-cols-2 items-center gap-6 py-5">
              <p className="text-sm font-semibold text-slate-900">Hotel Star Rating</p>
              <select
                className={inputClass}
                value={starRating ?? ''}
                onChange={(e) => setStarRating(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select rating</option>
                <option value="0">Unrated</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} Star
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 items-center gap-6 py-5">
              <p className="text-sm font-semibold text-slate-900">When was the property built?</p>
              <select
                className={inputClass}
                value={builtYear ?? ''}
                onChange={(e) => setBuiltYear(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select a year</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 items-center gap-6 py-5">
              <div>
                <p className="text-sm font-semibold text-slate-900">Accepting booking since?</p>
                <p className="mt-0.5 text-xs text-slate-500">Since when is this property available for guests to book</p>
              </div>
              <select
                className={inputClass}
                value={acceptingBookingsSince ?? ''}
                onChange={(e) => setAcceptingBookingsSince(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select a year</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50 px-6 py-5">
            <h2 className="text-base font-semibold text-slate-900">Contact details to be shared with guests</h2>
            <p className="mt-0.5 text-sm text-slate-500">These contact details will be shared with the guests when they make a booking</p>
          </div>

          <div className="divide-y divide-slate-100 px-6">
            <div className="grid grid-cols-2 items-center gap-6 py-5">
              <p className="text-sm font-semibold text-slate-900">Email ID</p>
              <VerifyField value={contactEmail} onChange={setContactEmail} placeholder="Enter email ID" type="email" />
            </div>

            <div className="grid grid-cols-2 items-start gap-6 py-5">
              <p className="pt-2 text-sm font-semibold text-slate-900">Mobile number</p>
              <div className="space-y-2">
                <VerifyField value={contactMobile} onChange={setContactMobile} placeholder="Enter number" prefix="+91" type="tel" />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={contactMobileIsWhatsapp}
                    onChange={(e) => setContactMobileIsWhatsapp(e.target.checked)}
                  />
                  Use the same mobile number for WhatsApp.
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 items-center gap-6 py-5">
              <p className="text-sm font-semibold text-slate-900">
                Landline number <span className="font-normal text-slate-400">(Optional)</span>
              </p>
              <input
                className={inputClass}
                value={contactLandline}
                onChange={(e) => setContactLandline(e.target.value)}
                placeholder="Eg: 0124 46373533"
              />
            </div>
          </div>
        </div>

        <label className="mt-6 flex items-start gap-2.5 text-sm text-slate-600">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={dpdpConsent}
            onChange={(e) => setDpdpConsent(e.target.checked)}
          />
          <span>
            I consent to this platform processing this hotel's guest and business data under the Digital Personal Data
            Protection (DPDP) Act, 2023, as a Data Fiduciary on our behalf.
          </span>
        </label>

        {(error || serverError) && <p className="mt-4 text-sm text-red-600">{error || serverError}</p>}

        <div className="mt-6 flex items-center justify-between pb-8">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            ← Back
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}

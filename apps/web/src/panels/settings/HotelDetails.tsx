import { useState } from 'react';
import { mutate, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, inputClass } from '../../components/ui';
import type { Hotel } from '../../types';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1950 + 1 }, (_, i) => CURRENT_YEAR - i);
const AMENITY_CATALOG = [
  'Free WiFi', 'Parking', 'Swimming Pool', 'Restaurant', 'Bar', 'Fitness Centre / Gym', 'Spa',
  'Lift / Elevator', 'Power Backup', 'CCTV Surveillance', '24-Hour Front Desk', 'Air Conditioning',
  'Laundry Service', 'Travel Desk', 'Doctor on Call', 'Banquet / Conference Hall', 'Airport Transfer',
  'Pet Friendly', 'Wheelchair Accessible', 'Garden / Lawn', 'Bonfire Pit', 'Room Service',
];
const CANCELLATION_LABEL: Record<string, string> = {
  free_till_checkin: 'Free cancellation till check-in',
  free_24h: 'Free cancellation up to 24h before check-in',
  free_48h: 'Free cancellation up to 48h before check-in',
  free_72h: 'Free cancellation up to 72h before check-in',
  non_refundable: 'Non-refundable',
};

/**
 * Settings → Hotel Details (§ user request) — everything captured during "List Your Property"
 * (basics, address, policies, amenities, finance & legal) is write-once today: the wizard never
 * surfaces it again. This is the first place an owner can come back and see/edit it afterward.
 * Each section is its own read-summary + inline edit form, saved independently via the same
 * per-step mutations the onboarding wizard itself uses (so this never diverges from that logic).
 */
export function HotelDetails({ hotel, onUpdated }: { hotel: Hotel; onUpdated: (h: Hotel) => void }) {
  return (
    <div className="space-y-6">
      <BasicInfoSection hotel={hotel} onUpdated={onUpdated} />
      <AddressSection hotel={hotel} onUpdated={onUpdated} />
      <PoliciesSection hotel={hotel} onUpdated={onUpdated} />
      <AmenitiesSection hotel={hotel} onUpdated={onUpdated} />
      <FinanceSection hotel={hotel} onUpdated={onUpdated} />
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  editing,
  onEditToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  editing: boolean;
  onEditToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <Button type="button" variant={editing ? 'ghost' : 'secondary'} onClick={onEditToggle}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
        }
      />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function SaveRow({ error, busy, onSave }: { error: string | null; busy: boolean; onSave: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button type="button" onClick={onSave} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function BasicInfoSection({ hotel, onUpdated }: { hotel: Hotel; onUpdated: (h: Hotel) => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(hotel.name);
  const [starRating, setStarRating] = useState(hotel.starRating ?? null);
  const [builtYear, setBuiltYear] = useState(hotel.builtYear ?? null);
  const [acceptingBookingsSince, setAcceptingBookingsSince] = useState(hotel.acceptingBookingsSince ?? null);
  const [contactEmail, setContactEmail] = useState(hotel.contactEmail ?? '');
  const [contactMobile, setContactMobile] = useState(hotel.contactMobile ?? '');
  const [contactMobileIsWhatsapp, setContactMobileIsWhatsapp] = useState(hotel.contactMobileIsWhatsapp ?? false);
  const [contactLandline, setContactLandline] = useState(hotel.contactLandline ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError('Hotel name cannot be empty');
      return;
    }
    setBusy(true);
    try {
      const updated = await mutate<Hotel>(
        'hotels.updateBasicInfo',
        {
          hotelId: hotel.id,
          name: name.trim(),
          starRating,
          builtYear,
          acceptingBookingsSince,
          contactEmail: contactEmail.trim(),
          contactMobile: contactMobile.trim(),
          contactMobileIsWhatsapp,
          contactLandline: contactLandline.trim(),
        },
        token ?? undefined,
      );
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Basic Info" subtitle="Property name, star rating, and guest-facing contact details." editing={editing} onEditToggle={() => setEditing((v) => !v)}>
      {!editing ? (
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Row label="Name" value={hotel.name} />
          <Row label="Star Rating" value={hotel.starRating != null ? (hotel.starRating === 0 ? 'Unrated' : `${hotel.starRating} Star`) : '—'} />
          <Row label="Built Year" value={hotel.builtYear ?? '—'} />
          <Row label="Accepting bookings since" value={hotel.acceptingBookingsSince ?? '—'} />
          <Row label="Email" value={hotel.contactEmail ?? '—'} />
          <Row label="Mobile" value={hotel.contactMobile ? `+91 ${hotel.contactMobile}${hotel.contactMobileIsWhatsapp ? ' (WhatsApp)' : ''}` : '—'} />
          <Row label="Landline" value={hotel.contactLandline ?? '—'} />
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name of the Property">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Star Rating">
              <select className={inputClass} value={starRating ?? ''} onChange={(e) => setStarRating(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select rating</option>
                <option value="0">Unrated</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>{n} Star</option>
                ))}
              </select>
            </Field>
            <Field label="Built Year">
              <select className={inputClass} value={builtYear ?? ''} onChange={(e) => setBuiltYear(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select a year</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Accepting bookings since">
              <select className={inputClass} value={acceptingBookingsSince ?? ''} onChange={(e) => setAcceptingBookingsSince(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select a year</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field label="Email ID">
              <input className={inputClass} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
            </Field>
            <Field label="Mobile number">
              <input className={inputClass} type="tel" value={contactMobile} onChange={(e) => setContactMobile(e.target.value)} />
            </Field>
            <Field label="Landline (optional)">
              <input className={inputClass} value={contactLandline} onChange={(e) => setContactLandline(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={contactMobileIsWhatsapp} onChange={(e) => setContactMobileIsWhatsapp(e.target.checked)} />
            Use the same mobile number for WhatsApp.
          </label>
          <SaveRow error={error} busy={busy} onSave={save} />
        </div>
      )}
    </SectionCard>
  );
}

function AddressSection({ hotel, onUpdated }: { hotel: Hotel; onUpdated: (h: Hotel) => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [addressLine, setAddressLine] = useState(hotel.addressLine ?? '');
  const [apartmentOrFloor, setApartmentOrFloor] = useState(hotel.apartmentOrFloor ?? '');
  const [city, setCity] = useState(hotel.city ?? '');
  const [state, setState] = useState(hotel.state ?? '');
  const [pincode, setPincode] = useState(hotel.pincode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const updated = await mutate<Hotel>(
        'hotels.updateAddress',
        { hotelId: hotel.id, addressLine: addressLine.trim(), apartmentOrFloor: apartmentOrFloor.trim(), city: city.trim(), state: state.trim(), pincode: pincode.trim() },
        token ?? undefined,
      );
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Address" subtitle="Where this property is actually located." editing={editing} onEditToggle={() => setEditing((v) => !v)}>
      {!editing ? (
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Row label="Address" value={hotel.addressLine ?? '—'} />
          <Row label="Apartment/Floor" value={hotel.apartmentOrFloor ?? '—'} />
          <Row label="City" value={hotel.city ?? '—'} />
          <Row label="State" value={hotel.state ?? '—'} />
          <Row label="Pincode" value={hotel.pincode ?? '—'} />
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Address Line">
              <input className={inputClass} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
            </Field>
            <Field label="Apartment/Floor (optional)">
              <input className={inputClass} value={apartmentOrFloor} onChange={(e) => setApartmentOrFloor(e.target.value)} />
            </Field>
            <Field label="City">
              <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="State">
              <input className={inputClass} value={state} onChange={(e) => setState(e.target.value)} />
            </Field>
            <Field label="Pincode">
              <input className={inputClass} value={pincode} onChange={(e) => setPincode(e.target.value)} />
            </Field>
          </div>
          <SaveRow error={error} busy={busy} onSave={save} />
        </div>
      )}
    </SectionCard>
  );
}

function PoliciesSection({ hotel, onUpdated }: { hotel: Hotel; onUpdated: (h: Hotel) => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [checkInTime, setCheckInTime] = useState(hotel.checkInTime ?? '');
  const [checkOutTime, setCheckOutTime] = useState(hotel.checkOutTime ?? '');
  const [cancellationPolicy, setCancellationPolicy] = useState(hotel.cancellationPolicy ?? 'free_till_checkin');
  const [allowUnmarriedCouples, setAllowUnmarriedCouples] = useState(hotel.allowUnmarriedCouples ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const updated = await mutate<Hotel>(
        'hotels.updatePolicies',
        { hotelId: hotel.id, checkInTime, checkOutTime, cancellationPolicy, allowUnmarriedCouples },
        token ?? undefined,
      );
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Policies" subtitle="Check-in/out times, cancellation, and couple policy." editing={editing} onEditToggle={() => setEditing((v) => !v)}>
      {!editing ? (
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Row label="Check-in time" value={hotel.checkInTime ?? '—'} />
          <Row label="Check-out time" value={hotel.checkOutTime ?? '—'} />
          <Row label="Cancellation policy" value={hotel.cancellationPolicy ? CANCELLATION_LABEL[hotel.cancellationPolicy] : '—'} />
          <Row label="Unmarried couples" value={hotel.allowUnmarriedCouples ? 'Allowed' : 'Not allowed'} />
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Check-in time">
              <input className={inputClass} type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
            </Field>
            <Field label="Check-out time">
              <input className={inputClass} type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
            </Field>
            <Field label="Cancellation policy">
              <select className={inputClass} value={cancellationPolicy} onChange={(e) => setCancellationPolicy(e.target.value as typeof cancellationPolicy)}>
                {Object.entries(CANCELLATION_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={allowUnmarriedCouples} onChange={(e) => setAllowUnmarriedCouples(e.target.checked)} />
            Allow unmarried couples
          </label>
          <SaveRow error={error} busy={busy} onSave={save} />
        </div>
      )}
    </SectionCard>
  );
}

function AmenitiesSection({ hotel, onUpdated }: { hotel: Hotel; onUpdated: (h: Hotel) => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(hotel.amenities ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(a: string) {
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const updated = await mutate<Hotel>('hotels.updateHotelAmenities', { hotelId: hotel.id, amenities: selected }, token ?? undefined);
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Amenities" subtitle="Facilities available at the property." editing={editing} onEditToggle={() => setEditing((v) => !v)}>
      {!editing ? (
        (hotel.amenities ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No amenities selected yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(hotel.amenities ?? []).map((a) => (
              <span key={a} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{a}</span>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {AMENITY_CATALOG.map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={selected.includes(a)} onChange={() => toggle(a)} />
                {a}
              </label>
            ))}
          </div>
          <SaveRow error={error} busy={busy} onSave={save} />
        </div>
      )}
    </SectionCard>
  );
}

function FinanceSection({ hotel, onUpdated }: { hotel: Hotel; onUpdated: (h: Hotel) => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [gstRegistration, setGstRegistration] = useState(hotel.gstRegistration ?? '');
  const [panNumber, setPanNumber] = useState(hotel.panNumber ?? '');
  const [bankAccountHolderName, setBankAccountHolderName] = useState(hotel.bankAccountHolderName ?? '');
  const [bankAccountNumber, setBankAccountNumber] = useState(hotel.bankAccountNumber ?? '');
  const [bankIfsc, setBankIfsc] = useState(hotel.bankIfsc ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const updated = await mutate<Hotel>(
        'hotels.updateFinance',
        { hotelId: hotel.id, gstRegistration, panNumber, bankAccountHolderName, bankAccountNumber, bankIfsc },
        token ?? undefined,
      );
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Finance & Legal" subtitle="GST/PAN and the bank account OTA payouts will go to." editing={editing} onEditToggle={() => setEditing((v) => !v)}>
      {!editing ? (
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Row label="GST Registration" value={hotel.gstRegistration ?? '—'} />
          <Row label="PAN Number" value={hotel.panNumber ?? '—'} />
          <Row label="Account Holder" value={hotel.bankAccountHolderName ?? '—'} />
          <Row label="Account Number" value={hotel.bankAccountNumber ?? '—'} />
          <Row label="IFSC Code" value={hotel.bankIfsc ?? '—'} />
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="GST Registration Number">
              <input className={inputClass} value={gstRegistration} onChange={(e) => setGstRegistration(e.target.value)} />
            </Field>
            <Field label="PAN Number">
              <input className={inputClass} value={panNumber} onChange={(e) => setPanNumber(e.target.value)} />
            </Field>
            <Field label="Account Holder Name">
              <input className={inputClass} value={bankAccountHolderName} onChange={(e) => setBankAccountHolderName(e.target.value)} />
            </Field>
            <Field label="Account Number">
              <input className={inputClass} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
            </Field>
            <Field label="IFSC Code">
              <input className={inputClass} value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <SaveRow error={error} busy={busy} onSave={save} />
        </div>
      )}
    </SectionCard>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

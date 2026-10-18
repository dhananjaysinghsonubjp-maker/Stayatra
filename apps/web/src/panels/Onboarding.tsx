import { useEffect, useRef, useState } from 'react';
import { assetUrl, mutate, query, uploadFile, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Toggle, inputClass } from '../components/ui';
import { PropertyAddressStep, type PropertyAddress } from './PropertyAddressStep';
import { BasicInfoStep, type BasicInfo } from './BasicInfoStep';
import { RoomsStep, type RoomCategoryDraft } from './RoomsStep';
import { PoliciesStep, type PoliciesInfo } from './PoliciesStep';
import { AmenitiesStep } from './AmenitiesStep';
import { PhotosAndVideosStep } from './PhotosAndVideosStep';
import { FinanceAndLegalStep, type FinanceInfo } from './FinanceAndLegalStep';
import { RoomDetailView } from './RoomDetailView';
import { HotelDetails } from './settings/HotelDetails';
import { Credentials } from './channel-manager/Credentials';
import { Billing } from './Billing';
import { StaffManagement } from './staff/StaffManagement';
import { applyBrandColor, isValidHexColor } from '../brandColor';
import { applyBrandFont, fontStackFor, DEFAULT_FONT_STACK } from '../brandFont';
import { FONT_FAMILIES, fontOptionId, ensureFontFamilyLoaded } from '../fontCatalog';
import type { Hotel, LedgerCategory, RatePlan, Room, RoomCategory } from '../types';

export type SettingsView = 'details' | 'brand' | 'rooms' | 'staff' | 'invoice' | 'ledger' | 'credentials' | 'billing';

export function Onboarding({
  hotel,
  onHotelCreated,
  hasPms = true,
  hasChannelManager = false,
  isOwner = false,
  view = 'details',
}: {
  hotel: Hotel | null;
  onHotelCreated: (h: Hotel) => void;
  /** Whether this org's plan includes PMS — gates the physical-room/staff-PIN setup steps below, which a Channel-Manager-only org has no use for. */
  hasPms?: boolean;
  /** Settings → Credentials page only makes sense once this org actually has Channel Manager. */
  hasChannelManager?: boolean;
  /** Settings → Billing page — billing concerns the whole org's subscription, visible to an owner regardless of which module that ownership is in. */
  isOwner?: boolean;
  /** Which Settings sidebar item is active — each is its own sidebar entry now (§ user request, matching Bulk Update's group pattern), not an in-page tab bar. */
  view?: SettingsView;
}) {
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // "List Your Property": address + map pin, then basic info (which mints the Hotel ID),
  // then room categories, policies, amenities, photos, and finally finance & legal —
  // collected step by step. The hotel record itself is created as soon as Basic Info is
  // submitted (real Hotel ID from here on); `onHotelCreated` (which hands off to the main
  // app shell) only fires once the last step (Finance & Legal) finishes, so this wizard
  // stays in control through every step in between.
  const [step, setStep] = useState<'address' | 'basics' | 'rooms' | 'policies' | 'amenities' | 'photos' | 'finance'>('address');
  const [address, setAddress] = useState<PropertyAddress | null>(null);
  const [basics, setBasics] = useState<BasicInfo | null>(null);
  const [createdHotel, setCreatedHotel] = useState<Hotel | null>(null);
  const [categoryCount, setCategoryCount] = useState(1);
  const [busy, setBusy] = useState(false);

  function onAddressContinue(addr: PropertyAddress) {
    setAddress(addr);
    setStep('basics');
  }

  async function onBasicsContinue(info: BasicInfo) {
    setBasics(info);
    setError(null);
    setBusy(true);
    try {
      const h = await mutate<Hotel>(
        'hotels.create',
        {
          name: info.name,
          addressLine: address?.addressLine || undefined,
          apartmentOrFloor: address?.apartmentOrFloor || undefined,
          city: address?.city || undefined,
          state: address?.state || undefined,
          pincode: address?.pincode || undefined,
          latitude: address?.latitude ?? undefined,
          longitude: address?.longitude ?? undefined,
          starRating: info.starRating ?? undefined,
          builtYear: info.builtYear ?? undefined,
          acceptingBookingsSince: info.acceptingBookingsSince ?? undefined,
          contactEmail: info.contactEmail || undefined,
          contactMobile: info.contactMobile || undefined,
          contactMobileIsWhatsapp: info.contactMobileIsWhatsapp,
          contactLandline: info.contactLandline || undefined,
          dpdpConsent: info.dpdpConsent,
        },
        token ?? undefined,
      );
      setCreatedHotel(h);
      setStep('rooms');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create hotel');
    } finally {
      setBusy(false);
    }
  }

  async function onRoomsContinue(categories: RoomCategoryDraft[]) {
    if (!createdHotel) return;
    setError(null);
    setBusy(true);
    try {
      for (const cat of categories) {
        const roomCategory = await mutate<RoomCategory>(
          'hotels.createRoomCategory',
          { hotelId: createdHotel.id, name: cat.name },
          token ?? undefined,
        );
        if (hasPms) {
          await mutate(
            'hotels.generatePlaceholderRooms',
            { hotelId: createdHotel.id, count: cat.count, roomCategoryId: roomCategory.id },
            token ?? undefined,
          );
        }
      }
      setCategoryCount(categories.length);
      setStep('policies');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save room categories');
    } finally {
      setBusy(false);
    }
  }

  async function onPoliciesContinue(policies: PoliciesInfo) {
    if (!createdHotel) return;
    setError(null);
    setBusy(true);
    try {
      await mutate(
        'hotels.updatePolicies',
        {
          hotelId: createdHotel.id,
          checkInTime: policies.checkInTime,
          checkOutTime: policies.checkOutTime,
          cancellationPolicy: policies.cancellationPolicy,
          allowUnmarriedCouples: policies.allowUnmarriedCouples ?? undefined,
        },
        token ?? undefined,
      );
      setStep('amenities');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save policies');
    } finally {
      setBusy(false);
    }
  }

  async function onAmenitiesContinue(amenities: string[]) {
    if (!createdHotel) return;
    setError(null);
    setBusy(true);
    try {
      await mutate('hotels.updateHotelAmenities', { hotelId: createdHotel.id, amenities }, token ?? undefined);
      setStep('photos');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save amenities');
    } finally {
      setBusy(false);
    }
  }

  async function onFinanceContinue(finance: FinanceInfo) {
    if (!createdHotel) return;
    setError(null);
    setBusy(true);
    try {
      await mutate(
        'hotels.updateFinance',
        {
          hotelId: createdHotel.id,
          gstRegistration: finance.gstRegistration.trim() || undefined,
          panNumber: finance.panNumber.trim() || undefined,
          bankAccountHolderName: finance.bankAccountHolderName.trim() || undefined,
          bankAccountNumber: finance.bankAccountNumber.trim() || undefined,
          bankIfsc: finance.bankIfsc.trim() || undefined,
        },
        token ?? undefined,
      );
      onHotelCreated(createdHotel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save finance & legal details');
    } finally {
      setBusy(false);
    }
  }

  if (!hotel) {
    if (step === 'address') {
      return (
        <PropertyAddressStep
          onContinue={onAddressContinue}
          onCancel={() => {
            /* nothing before this step yet — "Back" just re-confirms the same step */
          }}
        />
      );
    }
    if (step === 'basics') {
      return (
        <BasicInfoStep
          initial={basics ?? undefined}
          onContinue={onBasicsContinue}
          onBack={() => setStep('address')}
          busy={busy}
          serverError={error}
        />
      );
    }
    if (step === 'rooms') {
      return (
        <RoomsStep
          hotelName={createdHotel?.name ?? basics?.name ?? ''}
          onContinue={onRoomsContinue}
          onBack={() => setStep('basics')}
          busy={busy}
          serverError={error}
        />
      );
    }
    if (step === 'policies') {
      return (
        <PoliciesStep
          rateplanCount={categoryCount}
          onContinue={onPoliciesContinue}
          onBack={() => setStep('rooms')}
          busy={busy}
          serverError={error}
        />
      );
    }
    if (step === 'amenities') {
      return (
        <AmenitiesStep
          onContinue={onAmenitiesContinue}
          onBack={() => setStep('policies')}
          busy={busy}
          serverError={error}
        />
      );
    }
    if (step === 'photos') {
      return (
        <PhotosAndVideosStep
          hotelId={createdHotel!.id}
          onContinue={() => setStep('finance')}
          onBack={() => setStep('amenities')}
        />
      );
    }
    return (
      <FinanceAndLegalStep
        onContinue={onFinanceContinue}
        onBack={() => setStep('photos')}
        busy={busy}
        serverError={error}
      />
    );
  }

  return (
    <SettingsPage hotel={hotel} onHotelCreated={onHotelCreated} hasPms={hasPms} hasChannelManager={hasChannelManager} isOwner={isOwner} view={view} />
  );
}

const SETTINGS_TITLE: Record<SettingsView, string> = {
  details: 'Hotel Details',
  brand: 'Hotel Brand',
  rooms: 'Room Setup',
  staff: 'Staff & PINs',
  invoice: 'Invoice Settings',
  ledger: 'Ledger Categories',
  credentials: 'Credentials',
  billing: 'Billing',
};

/**
 * Settings (§ user request — was "Staff & Setup") — Hotel Details (everything captured during
 * onboarding, now viewable/editable afterward), Room Setup, Staff & PINs, Credentials, and
 * Billing. Each is its own Sidebar entry under a "Settings" group, same pattern as "Bulk
 * Update"'s Rate Update/Inventory Update/Advance Bulk Update children — not an in-page tab bar.
 */
function SettingsPage({
  hotel,
  onHotelCreated,
  hasPms,
  hasChannelManager,
  isOwner,
  view,
}: {
  hotel: Hotel;
  onHotelCreated: (h: Hotel) => void;
  hasPms: boolean;
  hasChannelManager: boolean;
  isOwner: boolean;
  view: SettingsView;
}) {
  const { token } = useAuth();

  return (
    <div>
      <PageHeader title={SETTINGS_TITLE[view]} subtitle={hotel.name} />
      {view === 'details' && (
        <div className="space-y-6">
          <Card className="mb-0">
            <CardBody className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Property ID (everyone logs in with this + their PIN)</span>
              <span className="rounded-md bg-amber-50 px-3 py-1 font-mono text-base font-semibold text-amber-700">{hotel.shortCode}</span>
            </CardBody>
          </Card>
          <HotelDetails hotel={hotel} onUpdated={onHotelCreated} />
        </div>
      )}
      {view === 'brand' && (
        <div className="space-y-6">
          <HotelLogoSection hotel={hotel} token={token} onUpdated={onHotelCreated} />
          <BannerTextSection hotel={hotel} token={token} onUpdated={onHotelCreated} />
          <BrandColorGate hotel={hotel} token={token} onUpdated={onHotelCreated} />
          <FontSetupSection hotel={hotel} token={token} onUpdated={onHotelCreated} />
        </div>
      )}
      {view === 'rooms' && (
        <div className="space-y-6">
          <RoomCategoriesSection hotelId={hotel.id} token={token} />
          {hasPms && <RoomsSection hotelId={hotel.id} token={token} />}
        </div>
      )}
      {view === 'staff' && (
        <div className="space-y-6">
          <MyPinSection token={token} />
          {hasPms && <StaffManagement hotelId={hotel.id} token={token} isOwner={isOwner} />}
        </div>
      )}
      {view === 'invoice' && <InvoiceSettingsSection hotel={hotel} token={token} onUpdated={onHotelCreated} />}
      {view === 'ledger' && <LedgerCategoriesSection hotelId={hotel.id} token={token} />}
      {view === 'credentials' && hasChannelManager && <Credentials hotelId={hotel.id} />}
      {view === 'billing' && isOwner && <Billing />}
    </div>
  );
}

/** The "Room Setup" table (§ user request, matching a reference OTA extranet's "Rooms & Rateplans" page) — onboards room types with a name + description, toggles them active/inactive, shows each one's linked rate plans at a glance, and "Edit Room" opens the full Room Details page (type/view/size/occupancy/bathroom/amenities/photos). */
function RoomCategoriesSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [ratePlansByCategory, setRatePlansByCategory] = useState<Record<string, RatePlan[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [viewingRoomId, setViewingRoomId] = useState<string | null>(null);
  const [addingRatePlanFor, setAddingRatePlanFor] = useState<string | null>(null);
  const [ratePlanName, setRatePlanName] = useState('');
  const [ratePlanMealPlan, setRatePlanMealPlan] = useState('');
  const [ratePlanIsDerived, setRatePlanIsDerived] = useState(false);
  const [ratePlanBaseId, setRatePlanBaseId] = useState('');
  const [ratePlanFormula, setRatePlanFormula] = useState('base + 500');
  const [ratePlanError, setRatePlanError] = useState<string | null>(null);
  const [editingRatePlanId, setEditingRatePlanId] = useState<string | null>(null);
  const [editRatePlanName, setEditRatePlanName] = useState('');
  const [editRatePlanMealPlan, setEditRatePlanMealPlan] = useState('');
  const [editRatePlanError, setEditRatePlanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const cats = await query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined);
    setCategories(cats);
    const entries = await Promise.all(
      cats.map(async (c) => [c.id, await query<RatePlan[]>('rates.listRatePlans', { roomCategoryId: c.id }, token ?? undefined)] as const),
    );
    setRatePlansByCategory(Object.fromEntries(entries));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('hotels.createRoomCategory', { hotelId, name: newName, description: newDescription.trim() || undefined }, token ?? undefined);
      setNewName('');
      setNewDescription('');
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create room');
    }
  }

  async function toggleActive(c: RoomCategory) {
    await mutate('hotels.updateRoomCategory', { roomCategoryId: c.id, active: !c.active }, token ?? undefined);
    await refresh();
  }

  async function addRatePlan(e: React.FormEvent, roomCategoryId: string) {
    e.preventDefault();
    setRatePlanError(null);
    if (!ratePlanName.trim()) {
      setRatePlanError('Enter a rate plan name');
      return;
    }
    if (ratePlanIsDerived && !ratePlanBaseId) {
      setRatePlanError('Select a base rate plan to derive from');
      return;
    }
    try {
      await mutate(
        'rates.createRatePlan',
        {
          roomCategoryId,
          name: ratePlanName.trim(),
          mealPlan: ratePlanMealPlan.trim() || undefined,
          isDerived: ratePlanIsDerived,
          baseRatePlanId: ratePlanIsDerived ? ratePlanBaseId : undefined,
          formula: ratePlanIsDerived ? ratePlanFormula || undefined : undefined,
        },
        token ?? undefined,
      );
      setRatePlanName('');
      setRatePlanMealPlan('');
      setRatePlanIsDerived(false);
      setRatePlanBaseId('');
      setAddingRatePlanFor(null);
      await refresh();
    } catch (err) {
      setRatePlanError(err instanceof ApiError ? err.message : 'Failed to create rate plan');
    }
  }

  function startEditRatePlan(p: RatePlan) {
    setEditingRatePlanId(p.id);
    setEditRatePlanName(p.name);
    setEditRatePlanMealPlan(p.mealPlan ?? '');
    setEditRatePlanError(null);
  }

  async function saveRatePlanEdit(e: React.FormEvent, ratePlanId: string) {
    e.preventDefault();
    setEditRatePlanError(null);
    if (!editRatePlanName.trim()) {
      setEditRatePlanError('Name is required');
      return;
    }
    try {
      await mutate(
        'rates.updateRatePlan',
        { ratePlanId, name: editRatePlanName.trim(), mealPlan: editRatePlanMealPlan.trim() || null },
        token ?? undefined,
      );
      setEditingRatePlanId(null);
      await refresh();
    } catch (err) {
      setEditRatePlanError(err instanceof ApiError ? err.message : 'Failed to save changes');
    }
  }

  async function deleteRatePlan(p: RatePlan) {
    if (!confirm(`Remove rate plan "${p.name}"? This can't be undone.`)) return;
    setEditRatePlanError(null);
    try {
      await mutate('rates.deleteRatePlan', { ratePlanId: p.id }, token ?? undefined);
      await refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete rate plan');
    }
  }

  if (viewingRoomId) {
    return (
      <RoomDetailView
        roomCategoryId={viewingRoomId}
        onBack={() => {
          setViewingRoomId(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title="Room Setup"
        subtitle={`Existing Rooms (${categories.length})`}
        action={
          <Button variant={showCreate ? 'ghost' : 'secondary'} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : '+ Create New Room'}
          </Button>
        }
      />
      <CardBody>
        {showCreate && (
          <form onSubmit={createRoom} className="mb-5 space-y-3 rounded-lg border border-slate-200 p-4">
            <Field label="Room Name">
              <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Deluxe Double" required />
            </Field>
            <Field label="Room Details">
              <textarea
                className={inputClass}
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What makes this room type different — bed, view, occupancy, etc."
              />
            </Field>
            <Button type="submit">Save Room</Button>
          </form>
        )}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {categories.length === 0 ? (
          <EmptyState title="No rooms yet" hint="Click Create New Room above to add your first room type." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="py-2 pr-4">Room Name</th>
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4">Active</th>
                  <th className="py-2">Rateplans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => {
                  const plans = ratePlansByCategory[c.id] ?? [];
                  return (
                    <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                      <td className="py-2.5 pr-4 align-top">
                        <p className="font-medium text-slate-900">{c.name}</p>
                        <button type="button" onClick={() => setViewingRoomId(c.id)} className="text-xs font-medium text-brand-600 hover:underline">
                          Edit Room
                        </button>
                      </td>
                      <td className="max-w-xs py-2.5 pr-4 align-top text-slate-500">{c.description || '—'}</td>
                      <td className="py-2.5 pr-4 align-top">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            checked={c.active}
                            onChange={() => void toggleActive(c)}
                          />
                          <span className="text-xs text-slate-500">{c.active ? 'Active' : 'Inactive'}</span>
                        </label>
                      </td>
                      <td className="py-2.5 align-top text-slate-500">
                        {plans.length === 0 ? (
                          <span className="text-xs text-slate-400">No rateplans yet</span>
                        ) : (
                          <ul className="space-y-1.5 text-xs">
                            {plans.map((p) =>
                              editingRatePlanId === p.id ? (
                                <li key={p.id}>
                                  <form onSubmit={(e) => void saveRatePlanEdit(e, p.id)} className="w-56 space-y-1.5 rounded-lg border border-brand-200 bg-brand-50/40 p-2.5">
                                    <input
                                      autoFocus
                                      className={`${inputClass} py-1 text-xs`}
                                      value={editRatePlanName}
                                      onChange={(e) => setEditRatePlanName(e.target.value)}
                                      placeholder="Name"
                                    />
                                    <input
                                      className={`${inputClass} py-1 text-xs`}
                                      value={editRatePlanMealPlan}
                                      onChange={(e) => setEditRatePlanMealPlan(e.target.value)}
                                      placeholder="Meal plan (optional)"
                                    />
                                    {editRatePlanError && <p className="text-xs text-red-600">{editRatePlanError}</p>}
                                    <div className="flex items-center gap-2 pt-0.5">
                                      <button type="submit" className="text-xs font-medium text-brand-600 hover:underline">
                                        Save
                                      </button>
                                      <button type="button" onClick={() => setEditingRatePlanId(null)} className="text-xs font-medium text-slate-400 hover:text-slate-600">
                                        Cancel
                                      </button>
                                    </div>
                                  </form>
                                </li>
                              ) : (
                                <li key={p.id} className="flex items-center justify-between gap-2">
                                  <span>
                                    {p.name}
                                    {p.mealPlan && <span className="ml-1 text-slate-400">· {p.mealPlan}</span>}
                                    {p.isDerived && (
                                      <span className="ml-1 text-slate-400">
                                        (derived: {p.formula} from {plans.find((x) => x.id === p.baseRatePlanId)?.name ?? '—'})
                                      </span>
                                    )}
                                  </span>
                                  <span className="flex shrink-0 gap-1.5">
                                    <button type="button" onClick={() => startEditRatePlan(p)} className="font-medium text-brand-600 hover:underline">
                                      Edit
                                    </button>
                                    <button type="button" onClick={() => void deleteRatePlan(p)} className="font-medium text-red-500 hover:underline">
                                      Remove
                                    </button>
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        )}
                        {addingRatePlanFor === c.id ? (
                          <form onSubmit={(e) => void addRatePlan(e, c.id)} className="mt-2 w-56 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                            <input
                              autoFocus
                              className={`${inputClass} py-1 text-xs`}
                              value={ratePlanName}
                              onChange={(e) => setRatePlanName(e.target.value)}
                              placeholder="Name — e.g. EP, CP, BAR"
                            />
                            <input
                              className={`${inputClass} py-1 text-xs`}
                              value={ratePlanMealPlan}
                              onChange={(e) => setRatePlanMealPlan(e.target.value)}
                              placeholder="Meal plan (optional)"
                            />
                            <label className="flex items-center gap-1.5 text-xs text-slate-600">
                              <input type="checkbox" checked={ratePlanIsDerived} onChange={(e) => setRatePlanIsDerived(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                              Derive from another plan
                            </label>
                            {ratePlanIsDerived && (
                              <>
                                <select className={`${inputClass} py-1 text-xs`} value={ratePlanBaseId} onChange={(e) => setRatePlanBaseId(e.target.value)}>
                                  <option value="">— base plan —</option>
                                  {plans.filter((p) => !p.isDerived).map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                                <input
                                  className={`${inputClass} py-1 text-xs`}
                                  value={ratePlanFormula}
                                  onChange={(e) => setRatePlanFormula(e.target.value)}
                                  placeholder="e.g. base + 500"
                                />
                              </>
                            )}
                            <div className="flex items-center gap-2 pt-0.5">
                              <button type="submit" className="text-xs font-medium text-brand-600 hover:underline">
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingRatePlanFor(null);
                                  setRatePlanError(null);
                                }}
                                className="text-xs font-medium text-slate-400 hover:text-slate-600"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAddingRatePlanFor(c.id);
                              setRatePlanName('');
                              setRatePlanMealPlan('');
                              setRatePlanIsDerived(false);
                              setRatePlanBaseId('');
                              setRatePlanError(null);
                            }}
                            className="mt-1.5 block text-xs font-medium text-brand-600 hover:underline"
                          >
                            + Add Rateplan
                          </button>
                        )}
                        {addingRatePlanFor === c.id && ratePlanError && <p className="mt-1 text-xs text-red-600">{ratePlanError}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RoomsSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [count, setCount] = useState(6);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomCategoryId, setNewRoomCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function refresh() {
    const [r, c] = await Promise.all([
      query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined),
      query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
    ]);
    setRooms(r);
    setCategories(c);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('hotels.generatePlaceholderRooms', { hotelId, count }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  async function addSingleRoom(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('hotels.addRoom', { hotelId, roomNumber: newRoomNumber, roomCategoryId: newRoomCategoryId || null }, token ?? undefined);
      setNewRoomNumber('');
      setNewRoomCategoryId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add room');
    }
  }

  /**
   * §user request — row edits used to commit silently on blur/select-change ("sync ho rahi hai
   * automatically"); now both the number and category only save when this row's own Save button
   * is clicked, as one explicit action instead of two separate implicit ones.
   */
  async function saveRoomRow(roomId: string, roomNumber: string, roomCategoryId: string, room: Room) {
    if (!roomNumber.trim()) {
      setRowError('Room number cannot be empty');
      return;
    }
    setRowError(null);
    try {
      if (roomNumber.trim() !== room.roomNumber) {
        await mutate('hotels.renameRoom', { roomId, roomNumber: roomNumber.trim() }, token ?? undefined);
      }
      if (roomCategoryId !== (room.roomCategoryId ?? '')) {
        await mutate('hotels.assignRoomCategory', { roomId, roomCategoryId: roomCategoryId || null }, token ?? undefined);
      }
      await refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to save changes');
      await refresh(); // revert the inputs to the persisted values
    }
  }

  async function remove(roomId: string, roomNumber: string) {
    if (!confirm(`Remove ${roomNumber}? This can't be undone if it has never been used.`)) return;
    setRowError(null);
    setDeletingId(roomId);
    try {
      await mutate('hotels.deleteRoom', { roomId }, token ?? undefined);
      await refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to remove room');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Rooms" subtitle="Generate placeholder rooms, then sort them into categories — or add/remove/rename rooms individually." />
      <CardBody>
        <form onSubmit={generate} className="mb-3 flex gap-2">
          <input className={`${inputClass} w-28`} type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} min={1} />
          <Button type="submit" variant="secondary">
            Generate placeholder rooms
          </Button>
        </form>
        <form onSubmit={addSingleRoom} className="mb-4 flex gap-2">
          <input
            className={`${inputClass} w-40`}
            placeholder="Room number/name"
            value={newRoomNumber}
            onChange={(e) => setNewRoomNumber(e.target.value)}
            required
          />
          <select className={`${inputClass} w-48`} value={newRoomCategoryId} onChange={(e) => setNewRoomCategoryId(e.target.value)}>
            <option value="">— uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            + Add room
          </Button>
        </form>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {rowError && <p className="mb-2 text-sm text-red-600">{rowError}</p>}
        {rooms.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="py-2 pr-4">Room</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rooms.map((r) => (
                  <RoomRow key={r.id} room={r} categories={categories} onSave={saveRoomRow} onRemove={remove} removing={deletingId === r.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RoomRow({
  room,
  categories,
  onSave,
  onRemove,
  removing,
}: {
  room: Room;
  categories: RoomCategory[];
  onSave: (roomId: string, roomNumber: string, roomCategoryId: string, room: Room) => void;
  onRemove: (roomId: string, roomNumber: string) => void;
  removing: boolean;
}) {
  const [roomNumber, setRoomNumber] = useState(room.roomNumber);
  const [roomCategoryId, setRoomCategoryId] = useState(room.roomCategoryId ?? '');
  useEffect(() => {
    setRoomNumber(room.roomNumber);
    setRoomCategoryId(room.roomCategoryId ?? '');
  }, [room.roomNumber, room.roomCategoryId]);
  const canRemove = room.status === 'available';
  const dirty = roomNumber !== room.roomNumber || roomCategoryId !== (room.roomCategoryId ?? '');

  return (
    <tr>
      <td className="py-2 pr-4">
        <input className={`${inputClass} w-44 py-1.5 font-medium text-slate-900`} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
      </td>
      <td className="py-2 pr-4">
        <select className={`${inputClass} py-1.5`} value={roomCategoryId} onChange={(e) => setRoomCategoryId(e.target.value)}>
          <option value="">— uncategorized —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-4 text-xs capitalize text-slate-500">{room.status}</td>
      <td className="py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          {dirty && (
            <button
              type="button"
              onClick={() => onSave(room.id, roomNumber, roomCategoryId, room)}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Save
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(room.id, room.roomNumber)}
            disabled={!canRemove || removing}
            title={canRemove ? 'Remove this room' : 'Cannot remove an occupied/housekeeping room'}
            className="text-xs font-medium text-red-500 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Self-service "set my own PIN" (§ user request) — the owner/manager signed up with
 * email+password, but day-to-day login is now Property ID + role + a 4-digit PIN for
 * everyone, so this is how they actually get a PIN in the first place. Not gated behind
 * `hasPms` — a Channel-Manager-only owner still needs to log in somehow.
 */
/** The sidebar's brand mark (§ user request — "rooms logo", professionalized). A single
 * image slot, not a gallery — uploading replaces whatever was there before. */
function HotelLogoSection({ hotel, token, onUpdated }: { hotel: Hotel; token: string | null; onUpdated: (h: Hotel) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/hotel-photo', file, token ?? undefined);
      const updated = await mutate<Hotel>('hotels.setLogo', { hotelId: hotel.id, filePath: result.filePath }, token ?? undefined);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Logo upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeLogo() {
    setError(null);
    try {
      const updated = await mutate<Hotel>('hotels.setLogo', { hotelId: hotel.id, filePath: null }, token ?? undefined);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove logo');
    }
  }

  return (
    <Card>
      <CardHeader title="1. Logo Setup" subtitle="Shown in the sidebar, top-left — replaces the plain letter avatar." />
      <CardBody>
        <div className="flex items-center gap-4">
          {hotel.logoFilePath ? (
            <img src={assetUrl(hotel.logoFilePath)} alt={hotel.name} className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white">
              {hotel.name?.[0]?.toUpperCase() ?? 'H'}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : hotel.logoFilePath ? 'Replace logo' : 'Upload logo'}
            </Button>
            {hotel.logoFilePath && (
              <button type="button" onClick={() => void removeLogo()} className="text-sm font-medium text-slate-400 hover:text-red-600 hover:underline">
                Remove
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files)}
            />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </CardBody>
    </Card>
  );
}

/**
 * §user request — simplified from an image upload to just text: "ye jo space hai white iske
 * banner setup karne ka option hata do, simply colour daal denge jo humne choose kiya hua aur
 * text ka option de denge." The header strip (App.tsx's Shell) uses the hotel's own Brand Colour
 * (section 3 below) as its background, with this text shown boldly on it — no image, no separate
 * colour field. The preview here mirrors exactly how the real header renders it.
 */
function BannerTextSection({ hotel, token, onUpdated }: { hotel: Hotel; token: string | null; onUpdated: (h: Hotel) => void }) {
  const [value, setValue] = useState(hotel.bannerText ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(hotel.bannerText ?? '');
  }, [hotel.bannerText]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await mutate<Hotel>('hotels.setBannerText', { hotelId: hotel.id, bannerText: value.trim() || null }, token ?? undefined);
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save banner text');
    } finally {
      setSaving(false);
    }
  }

  const dirty = value.trim() !== (hotel.bannerText ?? '');

  return (
    <Card>
      <CardHeader title="2. Banner Setup" subtitle="Shown across the top of every page, behind the theme/help/notification icons — uses your Brand Colour below as its background." />
      <CardBody>
        <Field label="Banner text">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. Skymax Hotel & BnB's"
            maxLength={60}
            className={inputClass}
          />
        </Field>
        <p className="mb-2 mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">Preview</p>
        <div className="overflow-hidden rounded-xl">
          <div className="flex h-24 items-center bg-brand-600 px-8">
            <span className="truncate text-2xl font-bold text-white">{value.trim() || 'Your banner text will appear here'}</span>
          </div>
        </div>
        <div className="mt-4">
          <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && !error && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Saved — applied across the app.</p>}
      </CardBody>
    </Card>
  );
}

const DEFAULT_BRAND_COLOR = '#0c2171'; // StayYatra's own default — matches index.css's --color-brand-600

// §user request — "colour code ka option toh de diya hai but aise colour pallet bhi do taki
// bnsa apne hisaab se select karle": quick-pick swatches alongside the custom picker/hex input,
// not a replacement for it.
const BRAND_COLOR_PRESETS = [
  { label: 'StayYatra Navy (default)', hex: '#0c2171' },
  { label: 'Indigo', hex: '#4f46e5' },
  { label: 'Navy', hex: '#002491' },
  { label: 'Royal Blue', hex: '#1d4ed8' },
  { label: 'Teal', hex: '#0d9488' },
  { label: 'Emerald', hex: '#059669' },
  { label: 'Amber', hex: '#d97706' },
  { label: 'Red', hex: '#dc2626' },
  { label: 'Rose', hex: '#e11d48' },
  { label: 'Purple', hex: '#7c3aed' },
  { label: 'Slate', hex: '#334155' },
];

/**
 * §user request — "ek brand apne colour theme ke according set kar sakta hai... jo bhi colours
 * hai heading me, today so far button, graph ka colour, buttons ka colour vo saare [theme colour]
 * ho jaenge." One hex colour, applied app-wide via CSS custom properties (brandColor.ts) — picking
 * updates the live preview immediately (optimistic, before Save actually persists it), and the
 * swatch buttons are just shortcuts into the same text input/colour picker, not a separate path.
 */
const FULL_SUITE_MODULES = ['pms', 'channel_manager', 'theft_protection'];

/**
 * §user request — "ye colour option sirf plans ke according hoga, jo hotel Channel Manager + PMS
 * + Theft Protection teeno kharid raha hai unhi ko colour change karne ka option milega, warna
 * basic colour theme hi rahega." Reads the org's actual purchased modules (billing.getStatus —
 * `enabledModules`, the same `OrganizationModule` entitlement Billing.tsx's own "what you've
 * purchased" card reads), not just what this user happens to have a role for, since those can
 * diverge. Gates Brand Colour only — Logo/Banner/Font stay available on every plan.
 */
function BrandColorGate({ hotel, token, onUpdated }: { hotel: Hotel; token: string | null; onUpdated: (h: Hotel) => void }) {
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);

  useEffect(() => {
    query<{ enabledModules: string[] }>('billing.getStatus', undefined, token ?? undefined)
      .then((s) => setEnabledModules(s.enabledModules))
      .catch(() => setEnabledModules([]));
  }, [token]);

  if (enabledModules === null) return null; // avoid a locked-card flash while this loads
  const entitled = FULL_SUITE_MODULES.every((m) => enabledModules.includes(m));

  if (!entitled) {
    return (
      <Card>
        <CardHeader title="3. Brand Colour" subtitle="Sets the theme colour used across buttons, headings, and charts throughout the app." />
        <CardBody>
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/60">
            <span className="mt-0.5 text-lg">🔒</span>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">Available on Channel Manager + PMS + Theft Protection</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your property uses StayYatra's default theme colour. Upgrading to all three modules unlocks a custom brand colour here.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return <BrandColorSection hotel={hotel} token={token} onUpdated={onUpdated} />;
}

function BrandColorSection({ hotel, token, onUpdated }: { hotel: Hotel; token: string | null; onUpdated: (h: Hotel) => void }) {
  const [value, setValue] = useState(hotel.brandColor ?? DEFAULT_BRAND_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(hotel.brandColor ?? DEFAULT_BRAND_COLOR);
  }, [hotel.brandColor]);

  function preview(hex: string) {
    setValue(hex);
    setSaved(false);
    if (isValidHexColor(hex)) applyBrandColor(hex);
  }

  async function save() {
    if (!isValidHexColor(value)) {
      setError('Enter a valid 6-digit hex colour, like #002491');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await mutate<Hotel>('hotels.setBrandColor', { hotelId: hotel.id, brandColor: value }, token ?? undefined);
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save brand colour');
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setSaving(true);
    setError(null);
    try {
      const updated = await mutate<Hotel>('hotels.setBrandColor', { hotelId: hotel.id, brandColor: null }, token ?? undefined);
      onUpdated(updated);
      setValue(DEFAULT_BRAND_COLOR);
      applyBrandColor(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset brand colour');
    } finally {
      setSaving(false);
    }
  }

  const dirty = value.toLowerCase() !== (hotel.brandColor ?? DEFAULT_BRAND_COLOR).toLowerCase();

  return (
    <Card>
      <CardHeader title="3. Brand Colour" subtitle="Sets the theme colour used across buttons, headings, and charts throughout the app." />
      <CardBody>
        <div className="mb-4 flex flex-wrap gap-2">
          {BRAND_COLOR_PRESETS.map((p) => (
            <button
              key={p.hex}
              type="button"
              title={p.label}
              onClick={() => preview(p.hex)}
              className={`h-8 w-8 rounded-full ring-2 ring-offset-2 transition-transform hover:scale-110 dark:ring-offset-slate-800 ${
                value.toLowerCase() === p.hex.toLowerCase() ? 'ring-slate-400 dark:ring-slate-300' : 'ring-transparent'
              }`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <input
            type="color"
            value={isValidHexColor(value) ? value : DEFAULT_BRAND_COLOR}
            onChange={(e) => preview(e.target.value)}
            className="h-12 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-transparent p-0.5 dark:border-slate-600"
            aria-label="Pick brand colour"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Hex code</label>
            <input
              type="text"
              value={value}
              onChange={(e) => preview(e.target.value)}
              placeholder="#4F46E5"
              className={`${inputClass} w-32 font-mono uppercase`}
              maxLength={7}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {hotel.brandColor && (
              <button type="button" onClick={() => void resetToDefault()} disabled={saving} className="text-sm font-medium text-slate-400 hover:text-red-600 hover:underline">
                Reset to default
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && !error && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Saved — applied across the app.</p>}
      </CardBody>
    </Card>
  );
}

/**
 * §user request — "font section me search karne ka option... thode jyada fonts... poori family
 * (Regular/Bold) rahegi": a searchable, expand-by-family picker (fontCatalog.ts), matching the
 * reference screenshot's "family name ▾ / Regular / Bold" pattern. Every family is preloaded on
 * mount so each row previews in its real typeface rather than a fallback.
 */
function FontSetupSection({ hotel, token, onUpdated }: { hotel: Hotel; token: string | null; onUpdated: (h: Hotel) => void }) {
  const [selected, setSelected] = useState<string | null>(hotel.fontFamily ?? null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelected(hotel.fontFamily ?? null);
  }, [hotel.fontFamily]);

  useEffect(() => {
    FONT_FAMILIES.forEach(ensureFontFamilyLoaded);
  }, []);

  function preview(optionId: string | null) {
    setSelected(optionId);
    setSaved(false);
    applyBrandFont(optionId);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await mutate<Hotel>('hotels.setFontFamily', { hotelId: hotel.id, fontFamily: selected }, token ?? undefined);
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save font');
    } finally {
      setSaving(false);
    }
  }

  const dirty = selected !== (hotel.fontFamily ?? null);
  const filteredFamilies = FONT_FAMILIES.filter((f) => f.label.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Card>
      <CardHeader title="4. Font Setup (Advanced)" subtitle="Optional — the app's current default font is used unless you pick another below." />
      <CardBody>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fonts…"
          className={`${inputClass} mb-3`}
        />

        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-600">
          <button
            type="button"
            onClick={() => preview(null)}
            style={{ fontFamily: DEFAULT_FONT_STACK }}
            className={`flex w-full items-center justify-between border-b border-slate-200 px-4 py-3 text-left last:border-0 dark:border-slate-600 ${
              selected === null ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <span className="text-sm font-semibold text-slate-900 dark:text-white">Default</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">The app's current font</span>
          </button>

          {filteredFamilies.map((family) => {
            const isOpen = expanded === family.id;
            return (
              <div key={family.id} className="border-b border-slate-200 last:border-0 dark:border-slate-600">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : family.id)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  <span style={{ fontFamily: family.stack }} className="text-sm font-semibold text-slate-900 dark:text-white">
                    {family.label}
                  </span>
                </button>
                {isOpen && (
                  <div className="pb-1">
                    {family.weights.map((w) => {
                      const optionId = fontOptionId(family.id, w.weight);
                      const isSelected = selected === optionId;
                      return (
                        <button
                          key={optionId}
                          type="button"
                          onClick={() => preview(optionId)}
                          style={{ fontFamily: family.stack, fontWeight: w.weight }}
                          className={`flex w-full items-center justify-between py-2 pl-11 pr-4 text-left text-sm ${
                            isSelected
                              ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
                              : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {w.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filteredFamilies.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No fonts match "{search}"</p>
          )}
        </div>

        <p className="mb-2 mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">Preview</p>
        <p style={{ fontFamily: fontStackFor(selected) }} className="text-xl text-slate-900 dark:text-white">
          The quick brown fox jumps over the lazy dog
        </p>

        <div className="mt-4">
          <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && !error && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">Saved — applied across the app.</p>}
      </CardBody>
    </Card>
  );
}

/**
 * §user request — "Invoice customization hum add kar sakte hain": licence number, UPI id, Terms &
 * Conditions, a stamp/signature image, and two print toggles — everything the real printable
 * invoice (BookingViewModal's "Print Invoice") reads. GST registration/PAN/bank details already
 * live in Hotel Details (Finance & Legal), so this doesn't duplicate those fields — it just notes
 * where they are, since the invoice prints them too.
 */
function InvoiceSettingsSection({ hotel, token, onUpdated }: { hotel: Hotel; token: string | null; onUpdated: (h: Hotel) => void }) {
  const [licenseNumber, setLicenseNumber] = useState(hotel.licenseNumber ?? '');
  const [upiId, setUpiId] = useState(hotel.upiId ?? '');
  const [invoiceTerms, setInvoiceTerms] = useState(hotel.invoiceTerms ?? '');
  const [showPaymentSummary, setShowPaymentSummary] = useState(hotel.showPaymentSummaryOnInvoice ?? false);
  const [showTerms, setShowTerms] = useState(hotel.showTermsOnInvoice ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const stampInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLicenseNumber(hotel.licenseNumber ?? '');
    setUpiId(hotel.upiId ?? '');
    setInvoiceTerms(hotel.invoiceTerms ?? '');
    setShowPaymentSummary(hotel.showPaymentSummaryOnInvoice ?? false);
    setShowTerms(hotel.showTermsOnInvoice ?? false);
  }, [hotel.licenseNumber, hotel.upiId, hotel.invoiceTerms, hotel.showPaymentSummaryOnInvoice, hotel.showTermsOnInvoice]);

  const dirty =
    licenseNumber !== (hotel.licenseNumber ?? '') ||
    upiId !== (hotel.upiId ?? '') ||
    invoiceTerms !== (hotel.invoiceTerms ?? '') ||
    showPaymentSummary !== (hotel.showPaymentSummaryOnInvoice ?? false) ||
    showTerms !== (hotel.showTermsOnInvoice ?? false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await mutate<Hotel>(
        'hotels.updateInvoiceSettings',
        {
          hotelId: hotel.id,
          licenseNumber: licenseNumber.trim() || null,
          upiId: upiId.trim() || null,
          invoiceTerms: invoiceTerms.trim() || null,
          showPaymentSummaryOnInvoice: showPaymentSummary,
          showTermsOnInvoice: showTerms,
        },
        token ?? undefined,
      );
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save invoice settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleStampFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploadingStamp(true);
    setError(null);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/hotel-photo', file, token ?? undefined);
      const updated = await mutate<Hotel>('hotels.setInvoiceStamp', { hotelId: hotel.id, filePath: result.filePath }, token ?? undefined);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stamp upload failed');
    } finally {
      setUploadingStamp(false);
      if (stampInputRef.current) stampInputRef.current.value = '';
    }
  }

  async function removeStamp() {
    setError(null);
    try {
      const updated = await mutate<Hotel>('hotels.setInvoiceStamp', { hotelId: hotel.id, filePath: null }, token ?? undefined);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove stamp');
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Invoice Details"
          subtitle="GST registration, PAN, and bank account are set in Hotel Details → Finance — they print on the invoice too, nothing to repeat here."
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Licence number">
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="Trade/FHRAI licence no., if any"
                className={inputClass}
              />
            </Field>
            <Field label="UPI ID">
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. skymaxhotel@okhdfcbank"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Terms & Conditions">
            <textarea
              value={invoiceTerms}
              onChange={(e) => setInvoiceTerms(e.target.value)}
              placeholder="Printed at the bottom of every invoice, if the toggle below is on."
              rows={4}
              className={`${inputClass} resize-y`}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Stamp / Signature" subtitle="Printed at the bottom of every invoice." />
        <CardBody>
          <div className="flex items-center gap-4">
            {hotel.invoiceStampPath ? (
              <img src={assetUrl(hotel.invoiceStampPath)} alt="Invoice stamp" className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 object-contain p-1 dark:border-slate-600" />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-600 dark:text-slate-500">
                None
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" onClick={() => stampInputRef.current?.click()} disabled={uploadingStamp}>
                {uploadingStamp ? 'Uploading…' : hotel.invoiceStampPath ? 'Replace' : 'Upload'}
              </Button>
              {hotel.invoiceStampPath && (
                <button type="button" onClick={() => void removeStamp()} className="text-sm font-medium text-slate-400 hover:text-red-600 hover:underline">
                  Remove
                </button>
              )}
              <input ref={stampInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void handleStampFile(e.target.files)} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What prints on the invoice" />
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">Payment summary</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Paid amount, method, and due, as a table on the invoice.</p>
            </div>
            <Toggle checked={showPaymentSummary} onChange={setShowPaymentSummary} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">Terms & Conditions</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Prints the text above, at the bottom of the invoice.</p>
            </div>
            <Toggle checked={showTerms} onChange={setShowTerms} />
          </div>
          <div className="pt-2">
            <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {saved && !error && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * §user request — "Ledger / Chart of Accounts": manage the categories (and subcategories) a cash
 * entry can be tagged with on the Ledger page. Seeded with a sensible starting set for this app's
 * own context (no restaurant/kitchen module, unlike the reference's list) the first time a hotel
 * opens this page — editable/removable from here afterward.
 */
function LedgerCategoriesSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCategories(await query<LedgerCategory[]>('ledger.listCategories', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load categories');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      await mutate('ledger.createCategory', { hotelId, name: newName.trim(), parentId: newParentId || undefined }, token ?? undefined);
      setNewName('');
      setNewParentId('');
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add category');
    }
  }

  async function removeCategory(id: string) {
    if (!confirm('Remove this category? Existing ledger entries just lose the tag, they stay.')) return;
    try {
      await mutate('ledger.deleteCategory', { categoryId: id }, token ?? undefined);
      void refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to remove category');
    }
  }

  const topLevel = categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  return (
    <Card>
      <CardHeader title="Ledger Categories" subtitle="What a Cash In/Out entry on the Ledger page can be tagged with." />
      <CardBody>
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {topLevel.map((cat) => (
            <div key={cat.id} className="py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900 dark:text-white">{cat.name}</span>
                <button type="button" onClick={() => void removeCategory(cat.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">
                  Remove
                </button>
              </div>
              {childrenOf(cat.id).map((sub) => (
                <div key={sub.id} className="mt-1.5 flex items-center justify-between pl-4">
                  <span className="text-xs text-slate-500 dark:text-slate-400">↳ {sub.name}</span>
                  <button type="button" onClick={() => void removeCategory(sub.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ))}
          {topLevel.length === 0 && <p className="py-4 text-sm text-slate-400 dark:text-slate-500">No categories yet.</p>}
        </div>

        <form onSubmit={addCategory} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-700">
          <Field label="New category/subcategory name">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Housekeeping Supplies" className={inputClass} />
          </Field>
          <Field label="Parent (optional — leave blank for a top-level category)">
            <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)} className={inputClass}>
              <option value="">— Top-level —</option>
              {topLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit">Add</Button>
        </form>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </CardBody>
    </Card>
  );
}

function MyPinSection({ token }: { token: string | null }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs don’t match');
      return;
    }
    setSaving(true);
    try {
      await mutate('auth.setMyPin', { pin }, token ?? undefined);
      setMessage('PIN saved. You can now log in with Property ID + your role + this PIN.');
      setPin('');
      setConfirmPin('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save PIN');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="My PIN" subtitle="Set the 4-digit PIN you'll use to log in, instead of email + password, going forward." />
      <CardBody>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-end">
          <Field label="New PIN">
            <input
              className={`${inputClass} text-center tracking-[0.4em]`}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="····"
              required
            />
          </Field>
          <Field label="Confirm PIN">
            <input
              className={`${inputClass} text-center tracking-[0.4em]`}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="····"
              required
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save PIN'}
          </Button>
          {error && <p className="sm:col-span-3 text-sm text-red-600">{error}</p>}
          {message && <p className="sm:col-span-3 text-sm text-emerald-600">{message}</p>}
        </form>
      </CardBody>
    </Card>
  );
}


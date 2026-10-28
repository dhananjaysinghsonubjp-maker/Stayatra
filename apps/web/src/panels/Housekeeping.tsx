import { useEffect, useMemo, useState } from 'react';
import { assetUrl, mutate, query, uploadFile, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { CameraCapture } from '../components/CameraCapture';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, inputClass } from '../components/ui';
import type { CleaningRecord, HousekeeperOption, InHouseRow, Room } from '../types';

// Mirrors apps/api/src/cleaning/cleaning.service.ts exactly — the server is the
// real source of truth, these are just so the wizard can show/disable things early.
const MIN_PHOTOS = 3;
const MIN_GUEST_CLEANING_NIGHTS = 2;

type WizardStep = 'room' | 'team' | 'photos' | 'success';

/** §Skymax reference (PhotoGrid.tsx) — exactly 3 fixed slots, each a filled thumbnail or an
 * empty dashed camera tile, not a dynamically-growing row with a separate "add" tile. */
function PhotoGrid({
  photos,
  uploading,
  onCapture,
  onRemove,
}: {
  photos: string[];
  uploading: boolean;
  onCapture: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {Array.from({ length: MIN_PHOTOS }).map((_, i) => {
        const photo = photos[i];
        if (photo) {
          return (
            <div key={i} className="group relative h-24 w-24 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <img src={assetUrl(photo)} alt={`Evidence ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute inset-0 hidden items-center justify-center bg-black/50 text-xs font-bold text-white group-hover:flex"
              >
                Remove
              </button>
            </div>
          );
        }
        return (
          <button
            key={`empty-${i}`}
            type="button"
            disabled={uploading}
            onClick={onCapture}
            className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-brand-500 hover:text-brand-600 disabled:opacity-50 dark:border-slate-600"
          >
            <span className="text-2xl">📷</span>
          </button>
        );
      })}
    </div>
  );
}

/** §Skymax reference (success.tsx) — a real confirmation screen (checkmark, summary card,
 * explanatory note), not an inline dismissible banner buried above the form. */
function SuccessScreen({
  room,
  kind,
  flagged,
  photoCount,
  primaryName,
  secondName,
  onDone,
}: {
  room: Room;
  kind: 'checkout' | 'guest_stay';
  flagged: boolean;
  photoCount: number;
  primaryName: string;
  secondName: string;
  onDone: () => void;
}) {
  const isGuestCleaning = kind === 'guest_stay';
  const title = isGuestCleaning ? 'Guest cleaning recorded' : flagged ? 'Cleaning recorded' : 'Room completed';
  const note = isGuestCleaning
    ? 'The guest has NOT been checked out. Their booking continues to its checkout date.'
    : flagged
      ? 'No guest check-in record matches this room. The owner has been notified to review it — the room is available either way.'
      : 'Room is now Available / Clean.';

  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-4xl text-emerald-600 dark:bg-emerald-900/40">✓</span>
      <h3 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Room {room.roomNumber}</p>

      <div className="mt-5 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <SummaryRow label="Housekeepers" value={secondName ? `${primaryName} + ${secondName}` : primaryName} />
        <SummaryRow label="Photos" value={`${photoCount}/${MIN_PHOTOS}`} />
        {isGuestCleaning ? (
          <SummaryRow label="Guest" value="Still checked in" />
        ) : flagged ? (
          <SummaryRow label="Guest check-in" value="None found" />
        ) : (
          <SummaryRow label="Check-out" value="Verified" />
        )}
        <SummaryRow label="Room status" value={isGuestCleaning ? 'IN HOUSE' : 'AVAILABLE'} last />
      </div>

      <p className="mt-4 max-w-sm text-xs text-slate-500 dark:text-slate-400">{note}</p>

      <Button className="mt-6 w-full max-w-sm" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${last ? '' : 'border-b border-slate-50 dark:border-slate-700/60'}`}>
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-xs font-bold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

/** New Cleaning — a real step-by-step wizard (room → guest-cleaning + second housekeeper →
 * photos → success), matching the Skymax reference app's actual housekeeping flow instead of
 * a one-shot form with simulated photo filenames. Exported so the dedicated housekeeping-role
 * app shell (HousekeepingApp.tsx) can embed it full-bleed via `bare`, outside the owner-facing
 * Card chrome this page itself uses. */
export function CleaningWizard({
  hotelId,
  rooms,
  housekeepers,
  selfId,
  selfName,
  onSubmitted,
  bare = false,
}: {
  hotelId: string;
  rooms: Room[];
  housekeepers: HousekeeperOption[];
  selfId: string | undefined;
  selfName: string;
  onSubmitted: () => void;
  bare?: boolean;
}) {
  const { token } = useAuth();
  const [step, setStep] = useState<WizardStep>('room');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [guestCleaning, setGuestCleaning] = useState(false);
  const [secondHousekeeperId, setSecondHousekeeperId] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedRecord, setSubmittedRecord] = useState<CleaningRecord | null>(null);
  // §user request — "submit karte time koi bug na aaye": a stable client-minted id for THIS
  // attempt, so a lost reply on flaky hotel wifi and a retry never creates a duplicate
  // CleaningRecord — the backend already supports this (§8.6), the frontend just wasn't sending
  // one. Regenerated on reset(), so the NEXT cleaning gets its own fresh id.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // §user request — "staff ke paas gallery se upload ka option nahi hona chahiye, sirf real-time
  // photo": a plain `<input type="file" capture>` only HINTS at the camera — most desktop browsers
  // and plenty of Android/Chrome configs ignore that hint and show the normal picker (gallery
  // included) anyway. A live getUserMedia viewfinder (same CameraCapture used for ID/receipt
  // photos elsewhere) makes picking from the gallery structurally impossible, not just discouraged.
  const [cameraOpen, setCameraOpen] = useState(false);

  function reset() {
    setStep('room');
    setSelectedRoom(null);
    setGuestCleaning(false);
    setSecondHousekeeperId('');
    setPhotos([]);
    setError(null);
    setSubmittedRecord(null);
    setSubmissionId(crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  // §user request — housekeeping keeps its full existing flexibility: it can open and clean
  // ANY room, whether or not the FMO has checked a guest in or out through the app (§Scenario
  // 2/3). Availability depends only on the cleaning workflow completing, never on FMO action —
  // so the room list is intentionally unfiltered, same as it always was.
  const activeStay = selectedRoom?.currentStay && selectedRoom.currentStay.status === 'checked_in' ? selectedRoom.currentStay : null;
  const guestCleaningEligible = Boolean(activeStay && activeStay.nights >= MIN_GUEST_CLEANING_NIGHTS);
  const otherHousekeepers = housekeepers.filter((h) => h.id !== selfId);
  // §Skymax reference — the two-person rule is mandatory there (Continue stays disabled until
  // someone is picked). Kept here too, but only when there IS someone else to pick — a
  // single-housekeeper property can't be made to pick a partner that doesn't exist.
  const secondRequired = otherHousekeepers.length > 0;
  const canContinueFromTeam = !secondRequired || secondHousekeeperId !== '';

  async function handlePhotoCapture(file: File) {
    setError(null);
    setUploading(true);
    try {
      // Sequential, one at a time — a batched upload is what OOM-crashed low-end phones
      // in the reference app this is modelled on (§ Skymax FEATURES.md 4.3).
      const uploaded = await uploadFile<{ filePath: string }>('uploads/cleaning-photo', file, token ?? undefined);
      setPhotos((prev) => [...prev, uploaded.filePath]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo upload failed');
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!selectedRoom) return;
    setSubmitting(true);
    setError(null);
    const kind = guestCleaning && guestCleaningEligible ? 'guest_stay' : 'checkout';
    try {
      const record = await mutate<CleaningRecord>(
        'cleaning.submit',
        { id: submissionId, hotelId, roomId: selectedRoom.id, kind, secondHousekeeperId: secondHousekeeperId || undefined, photos },
        token ?? undefined,
      );
      setSubmittedRecord(record);
      setStep('success');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <>
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {step === 'room' && (
          <div>
            {/* §user request — "ye boys ko availability se koi relation nahi hai, inko simply
                bas rooms dikhenge": no status badge here, matching the Skymax reference app's
                plain room list exactly (availability is a front-desk/owner concern, not theirs).
                Every room is listed — housekeeping can clean any of them, with or without a
                prior FMO check-in/check-out on record (§Scenario 2/3). */}
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Select a room to clean.</p>
            {rooms.length === 0 ? (
              <EmptyState title="No rooms yet" />
            ) : (
              <div className="space-y-2">
                {rooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelectedRoom(r);
                      setGuestCleaning(false);
                      setSecondHousekeeperId('');
                      setStep('team');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left font-bold text-slate-900 shadow-sm transition-shadow hover:bg-slate-50 hover:shadow dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700/50"
                  >
                    Room {r.roomNumber}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'team' && selectedRoom && (
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-white">Room {selectedRoom.roomNumber}</p>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Primary housekeeper: {selfName}</p>

            {guestCleaningEligible && activeStay && (
              <button
                type="button"
                onClick={() => setGuestCleaning((v) => !v)}
                className={`mb-5 flex w-full items-start gap-3 rounded-xl border p-3.5 text-left shadow-sm ${
                  guestCleaning ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold ${
                    guestCleaning ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 text-transparent dark:border-slate-600'
                  }`}
                >
                  ✓
                </span>
                <span>
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">Guest Cleaning</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    Guest is booked for {activeStay.nights} nights. Tick this when cleaning during the stay — the guest stays
                    checked in. Leave it unticked only for the final checkout clean.
                  </span>
                </span>
              </button>
            )}

            <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {secondRequired ? 'Select second housekeeper' : 'No other housekeeping staff on this property yet'}
            </p>
            {secondRequired && (
              <div className="space-y-2">
                {otherHousekeepers.map((h) => {
                  const selected = secondHousekeeperId === h.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setSecondHousekeeperId(h.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3.5 text-left shadow-sm ${
                        selected
                          ? 'border-brand-600 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                      }`}
                    >
                      <span className={`text-sm font-semibold ${selected ? 'text-brand-700 dark:text-brand-300' : 'text-slate-900 dark:text-white'}`}>
                        {h.name}
                      </span>
                      {selected && <span className="text-brand-600 dark:text-brand-400">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" onClick={() => setStep('room')}>
                ← Back
              </Button>
              <Button onClick={() => setStep('photos')} disabled={!canContinueFromTeam}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'photos' && selectedRoom && (
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-white">Room {selectedRoom.roomNumber}</p>
            <p className="mb-1 mt-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              Take at least {MIN_PHOTOS} photos: bedroom, bathroom, overall room ({photos.length}/{MIN_PHOTOS})
            </p>
            <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Camera only — evidence can't be picked from the gallery.</p>
            <PhotoGrid photos={photos} uploading={uploading} onCapture={() => setCameraOpen(true)} onRemove={removePhoto} />
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" onClick={() => setStep('team')}>
                ← Back
              </Button>
              <Button onClick={submit} disabled={photos.length < MIN_PHOTOS || submitting || uploading}>
                {submitting ? 'Submitting…' : guestCleaning && guestCleaningEligible ? 'Submit Guest Cleaning' : 'Submit Cleaning'}
              </Button>
            </div>
            {cameraOpen && (
              <CameraCapture
                onCapture={(file) => {
                  setCameraOpen(false);
                  handlePhotoCapture(file);
                }}
                onClose={() => setCameraOpen(false)}
              />
            )}
          </div>
        )}

      {step === 'success' && selectedRoom && submittedRecord && (
        <SuccessScreen
          room={selectedRoom}
          kind={guestCleaning && guestCleaningEligible ? 'guest_stay' : 'checkout'}
          flagged={submittedRecord.flagged}
          photoCount={submittedRecord.photos.length}
          primaryName={selfName}
          secondName={housekeepers.find((h) => h.id === secondHousekeeperId)?.name ?? ''}
          onDone={reset}
        />
      )}
    </>
  );

  if (bare) return body;

  return (
    <Card className="mb-6">
      <CardHeader title="New Cleaning" subtitle="Clean any room, any time — Checkout Cleaning frees the room to Available as soon as it's submitted." />
      <CardBody>{body}</CardBody>
    </Card>
  );
}

// ── Owner-facing: unified Discrepancies (§Skymax reference — NO_GUEST + DELAYED
// in one list, not split across two separate screens) ──────────────────────────

type Discrepancy =
  | { kind: 'no_guest'; key: string; record: CleaningRecord; roomNumber: string }
  | { kind: 'delayed'; key: string; row: InHouseRow };

function DiscrepancyCard({
  item,
  canResolve,
  onResolve,
}: {
  item: Discrepancy;
  canResolve: boolean;
  onResolve: (note: string) => Promise<void>;
}) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    try {
      await onResolve(note);
    } finally {
      setSaving(false);
      setResolving(false);
      setNote('');
    }
  }

  const title =
    item.kind === 'no_guest'
      ? `No guest check-in found — Room ${item.roomNumber}`
      : `Past cleaning deadline — Room ${item.row.room.roomNumber}`;
  const meta =
    item.kind === 'no_guest'
      ? `${item.record.photos.length} photos submitted on ${new Date(item.record.createdAt).toLocaleString()} with no matching guest stay record for this room.`
      : `Checkout cleaning is overdue — deadline was ${new Date(item.row.cleaningDeadline).toLocaleString()}.`;

  return (
    <div className="mb-2 rounded-xl border border-red-200 bg-red-50 p-3.5 dark:border-red-900/50 dark:bg-red-900/20">
      <p className="text-sm font-bold uppercase tracking-wide text-red-800 dark:text-red-300">{title}</p>
      <p className="mt-1 text-xs text-red-700 dark:text-red-400">{meta}</p>
      {resolving ? (
        <div className="mt-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resolution note (optional) — e.g. what you found out"
            className={`${inputClass} min-h-[60px] w-full`}
          />
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setResolving(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={confirm} disabled={saving}>
              {saving ? 'Saving…' : 'Mark as Resolved'}
            </Button>
          </div>
        </div>
      ) : canResolve ? (
        <button onClick={() => setResolving(true)} className="mt-2 text-xs font-bold text-emerald-700 underline dark:text-emerald-400">
          Resolve
        </button>
      ) : null}
    </div>
  );
}


export function Housekeeping({ hotelId, hideHeader = false }: { hotelId: string; hideHeader?: boolean }) {
  const { token, user, role } = useAuth();
  const isHousekeeping = role('pms') === 'housekeeping';
  const isManager = role('pms') === 'manager';
  const canSubmitCleanings = ['owner', 'manager', 'housekeeping'].includes(role('pms') ?? '');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [inHouseRows, setInHouseRows] = useState<InHouseRow[]>([]);
  const [housekeepers, setHousekeepers] = useState<HousekeeperOption[]>([]);
  const canResolve = ['owner', 'manager'].includes(role('pms') ?? '');
  const canSeeTeamStatus = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    const [r, c, h] = await Promise.all([
      query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
      query<CleaningRecord[]>('cleaning.list', { hotelId }, token ?? undefined),
      query<HousekeeperOption[]>('cleaning.listHousekeepers', { hotelId }, token ?? undefined),
    ]);
    setRooms(r);
    setRecords(c);
    setHousekeepers(h);
    if (canSeeTeamStatus) {
      setInHouseRows(await query<InHouseRow[]>('bookings.listInHouse', { hotelId }, token ?? undefined));
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  // §Skymax reference (DiscrepanciesList.tsx) — NO_GUEST and DELAYED shown together as one
  // list, not split across two unrelated screens the way Housekeeping/In-House used to.
  const discrepancies: Discrepancy[] = useMemo(() => {
    const noGuest: Discrepancy[] = records
      .filter((r) => r.flagged && !r.resolvedAt)
      .map((r) => ({ kind: 'no_guest', key: `cleaning-${r.id}`, record: r, roomNumber: rooms.find((rm) => rm.id === r.roomId)?.roomNumber ?? r.roomId }));
    const delayed: Discrepancy[] = inHouseRows
      .filter((row) => row.delayed)
      .map((row) => ({ kind: 'delayed', key: `stay-${row.booking.id}`, row }));
    return [...noGuest, ...delayed];
  }, [records, rooms, inHouseRows]);

  async function resolveNoGuest(cleaningRecordId: string, note: string) {
    await mutate('cleaning.resolveDiscrepancy', { cleaningRecordId, note: note || 'Resolved' }, token ?? undefined);
    await refresh();
  }
  async function resolveDelayed(bookingId: string, note: string) {
    await mutate('bookings.resolveDelay', { bookingId, note: note || 'Resolved' }, token ?? undefined);
    await refresh();
  }

  // Housekeeping sees its own history only (§ Skymax reference: "Personal cleaning history") —
  // owner/manager/front_desk see every room's history, which is what resolving a discrepancy needs.
  const visibleRecords = isHousekeeping
    ? records.filter((r) => r.primaryHousekeeperId === user?.userId || r.secondHousekeeperId === user?.userId)
    : records;

  // §user request — "FMO ke housekeeping vale section me sirf housekeeping team ki details
  // rakhni hai": a GM/FMO's view of this page is just the roster, nothing else (New Cleaning,
  // Discrepancies, Cleaning history stay owner-only here).
  if (isManager) {
    return (
      <div>
        {!hideHeader && <PageHeader title="Housekeeping" />}
        <Card>
          <CardHeader title="Housekeeping team" subtitle="Who's on housekeeping, and their shift." />
          <CardBody>
            {housekeepers.length === 0 ? (
              <EmptyState title="No housekeeping staff yet" hint="Add them from Settings → Hotel Team → Staff" />
            ) : (
              <div className="space-y-2">
                {housekeepers.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{h.name}</p>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{h.shift ?? 'Shift not set'}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {!hideHeader && <PageHeader title="Housekeeping" />}

      {canSubmitCleanings && (
        <CleaningWizard
          hotelId={hotelId}
          rooms={rooms}
          housekeepers={housekeepers}
          selfId={user?.userId}
          selfName={user?.userId ? housekeepers.find((h) => h.id === user.userId)?.name ?? 'You' : 'You'}
          onSubmitted={refresh}
        />
      )}

      {canSeeTeamStatus && discrepancies.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Discrepancies" subtitle={`${discrepancies.length} need${discrepancies.length === 1 ? 's' : ''} review`} />
          <CardBody>
            {discrepancies.map((item) =>
              item.kind === 'no_guest' ? (
                <DiscrepancyCard key={item.key} item={item} canResolve={canResolve} onResolve={(note) => resolveNoGuest(item.record.id, note)} />
              ) : (
                <DiscrepancyCard key={item.key} item={item} canResolve={canResolve} onResolve={(note) => resolveDelayed(item.row.booking.id, note)} />
              ),
            )}
          </CardBody>
        </Card>
      )}

      {/* §user request — just the roster: who's in housekeeping and which shift they work.
          No cleaning counts/stats here any more (that detail moved out of this card). */}
      {canSeeTeamStatus && (
        <Card className="mb-6">
          <CardHeader title="Housekeeping team" subtitle="Who's on housekeeping, and their shift." />
          <CardBody>
            {housekeepers.length === 0 ? (
              <EmptyState title="No housekeeping staff yet" hint="Add them from Settings → Hotel Team → Staff" />
            ) : (
              <div className="space-y-2">
                {housekeepers.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{h.name}</p>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{h.shift ?? 'Shift not set'}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={isHousekeeping ? 'My cleaning history' : 'Cleaning history'} />
        {visibleRecords.length === 0 ? (
          <CardBody>
            <EmptyState title="No cleanings submitted yet" />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Room</th>
                  <th className="px-5 py-3">Kind</th>
                  <th className="px-5 py-3">Photos</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRecords.map((r) => (
                  <tr key={r.id} className={r.flagged && !r.resolvedAt ? 'bg-red-50/60' : 'hover:bg-slate-50'}>
                    <td className="px-5 py-3 font-medium text-slate-900">{rooms.find((rm) => rm.id === r.roomId)?.roomNumber ?? r.roomId}</td>
                    <td className="px-5 py-3 text-slate-500">{r.kind === 'checkout' ? 'Checkout' : 'Guest Cleaning'}</td>
                    <td className="px-5 py-3 text-slate-500">{r.photos.length}</td>
                    <td className="px-5 py-3">{r.flagged ? <Badge tone="flagged">no-guest discrepancy</Badge> : <Badge tone="available">ok</Badge>}</td>
                    <td className="px-5 py-3 text-slate-500">{r.resolvedAt ? r.resolvedNote ?? 'resolved' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

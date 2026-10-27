import { useEffect, useRef, useState } from 'react';
import { assetUrl, mutate, query, uploadFile, ApiError } from '../../api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, inputClass } from '../../components/ui';
import { AddStaffForm } from './AddStaffForm';
import { AadhaarReviewView } from './AadhaarReviewView';
import { DESIGNATION_OPTIONS, SHIFT_OPTIONS } from './designations';
import type { StaffProfile } from '../../types';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  manager: 'General Manager',
  front_desk: 'General Manager (Front Desk)', // legacy value — pre-2026-10-15 staff rows
  housekeeping: 'Housekeeping Staff',
};

// §user request — "position wise properly define ho ki samajh mein aaye": the roster used to be
// one flat list (hardest-to-scan arrangement for exactly the thing a hotel actually wants —
// "who's my GM, who's FMO, who's housekeeping"). Fixed order, not alphabetical, so it always
// reads top-down by seniority the way the hotel itself thinks about it.
const GROUP_ORDER = ['General Manager', 'Front Office Manager', 'Housekeeping Staff'];
function groupLabel(s: StaffProfile): string {
  return s.designation ?? ROLE_LABEL[s.role ?? ''] ?? 'Other';
}

const STATUS_TONE: Record<StaffProfile['approvalStatus'], 'pending' | 'confirmed' | 'error'> = {
  pending: 'pending',
  approved: 'confirmed',
  rejected: 'error',
};

function Avatar({ name, photoPath }: { name: string; photoPath: string | null }) {
  if (photoPath) {
    return <img src={assetUrl(photoPath)} alt={name} className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600" />;
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

/** Detail panel for one staff profile — opened by clicking their row. Owner gets the full
 * edit/approve/PIN/remove view; a GM/FMO (manager) gets a read-only view of the same profile
 * — "FMO ko staff list bhi dikhegi" but approve/reject/PIN-mint/remove/edit stay owner-only
 * (confirmed explicitly, 2026-10-15), so there's nothing here a non-owner's Save/Approve/etc.
 * click could ever succeed at — the fields are read-only rather than editable-but-forbidden. */
function StaffDetail({
  token,
  profile,
  isOwner,
  onClose,
  onChanged,
}: {
  token: string | null;
  profile: StaffProfile;
  isOwner: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [designation, setDesignation] = useState(
    profile.designation ?? DESIGNATION_OPTIONS.find((d) => d.role === profile.role)?.designation ?? DESIGNATION_OPTIONS[2].designation,
  );
  const [shift, setShift] = useState(profile.shift ?? SHIFT_OPTIONS[0]);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [idNumber, setIdNumber] = useState(profile.idNumber ?? '');
  const [photoPath, setPhotoPath] = useState(profile.photoPath);
  const [idPhotoFrontPath, setIdPhotoFrontPath] = useState(profile.idPhotoFrontPath);
  const [idPhotoBackPath, setIdPhotoBackPath] = useState(profile.idPhotoBackPath);
  const [pin, setPin] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [showIdReview, setShowIdReview] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const idFrontInputRef = useRef<HTMLInputElement>(null);
  const idBackInputRef = useRef<HTMLInputElement>(null);

  async function replacePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/staff-photo', file, token ?? undefined);
      setPhotoPath(result.filePath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo upload failed');
    }
  }
  async function replaceIdFront(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/staff-id', file, token ?? undefined);
      setIdPhotoFrontPath(result.filePath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aadhar upload failed');
    }
  }
  async function replaceIdBack(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/staff-id', file, token ?? undefined);
      setIdPhotoBackPath(result.filePath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aadhar upload failed');
    }
  }

  async function saveProfile() {
    setBusy(true);
    setError(null);
    try {
      const role = DESIGNATION_OPTIONS.find((d) => d.designation === designation)?.role;
      await mutate(
        'staff.updateProfile',
        {
          userId: profile.id,
          name,
          designation,
          role,
          shift: role === 'housekeeping' ? shift : undefined,
          phone: phone || undefined,
          photoPath: photoPath || undefined,
          idNumber: idNumber || undefined,
          idPhotoFrontPath: idPhotoFrontPath || undefined,
          idPhotoBackPath: idPhotoBackPath || undefined,
        },
        token ?? undefined,
      );
      setMessage('Saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function removeStaff() {
    setBusy(true);
    setError(null);
    try {
      await mutate('staff.remove', { userId: profile.id }, token ?? undefined);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove');
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      // §user request — "approve karte hi automatically 4-digit PIN ban jaaye, WhatsApp/SMS pe
      // chala jaaye": approve() now mints the PIN itself — no separate "Set PIN" step for a
      // brand-new profile. No real WhatsApp/SMS gateway exists yet, so `delivered` comes back
      // false and the PIN comes back in plaintext once, here, so the owner can relay it
      // themselves in the meantime (never persisted or shown anywhere else in plaintext).
      const result = await mutate<{ pin: string; delivered: boolean; channel: string }>(
        'staff.approve',
        { userId: profile.id },
        token ?? undefined,
      );
      setMessage(
        result.delivered
          ? `Approved — PIN sent to ${profile.name} via ${result.channel}.`
          : `Approved — PIN ${result.pin} generated. WhatsApp/SMS delivery isn't connected yet, so please share this PIN with ${profile.name} yourself.`,
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await mutate('staff.reject', { userId: profile.id, note: rejectNote || 'Not approved' }, token ?? undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject');
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    setBusy(true);
    setError(null);
    try {
      await mutate('staff.setPin', { userId: profile.id, pin }, token ?? undefined);
      setMessage('PIN set.');
      setPin('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set PIN');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={profile.name}
        subtitle={profile.designation ?? ROLE_LABEL[profile.role ?? ''] ?? profile.role ?? ''}
        action={
          <button onClick={onClose} className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">
            ← Back to list
          </button>
        }
      />
      <CardBody>
        {message && <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
        {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mb-4 flex items-center gap-2">
          <Badge tone={STATUS_TONE[profile.approvalStatus]}>{profile.approvalStatus}</Badge>
          {profile.approvalStatus === 'rejected' && profile.approvalNote && (
            <span className="text-xs text-slate-500 dark:text-slate-400">— {profile.approvalNote}</span>
          )}
        </div>

        {profile.approvalStatus === 'pending' &&
          (isOwner ? (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">Submitted by the GM/front desk — review and decide.</p>
              {/* §user request — "ek single page mein dikhe jo printable rahega": front+back
                  combined, before the Approve/Reject decision, not two thumbnails in the edit
                  form below. */}
              {(idPhotoFrontPath || idPhotoBackPath) && !rejecting && (
                <Button type="button" variant="secondary" className="mb-3" onClick={() => setShowIdReview(true)}>
                  📄 View Aadhaar for review
                </Button>
              )}
              {rejecting ? (
                <div className="space-y-2">
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Reason (optional)"
                    className={`${inputClass} min-h-[60px] w-full`}
                  />
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setRejecting(false)}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={reject} disabled={busy}>
                      Confirm reject
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={approve} disabled={busy} className="!bg-emerald-600 hover:!bg-emerald-700">
                    ✓ Approve
                  </Button>
                  <Button variant="danger" onClick={() => setRejecting(true)} disabled={busy}>
                    ✕ Reject
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="mb-5 text-xs text-amber-700 dark:text-amber-400">Waiting on the owner's review.</p>
          ))}

        {!isOwner && (
          <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
            View only — editing, PIN, and remove stay with the owner.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name">
            {isOwner ? <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /> : <p className="text-sm text-slate-700 dark:text-slate-300">{name}</p>}
          </Field>
          <Field label="Role">
            {isOwner ? (
              <select className={inputClass} value={designation} onChange={(e) => setDesignation(e.target.value)}>
                {DESIGNATION_OPTIONS.map((d) => (
                  <option key={d.designation} value={d.designation}>
                    {d.designation}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-300">{designation}</p>
            )}
          </Field>
          {DESIGNATION_OPTIONS.find((d) => d.designation === designation)?.role === 'housekeeping' && (
            <Field label="Shift">
              {isOwner ? (
                <select className={inputClass} value={shift} onChange={(e) => setShift(e.target.value)}>
                  {SHIFT_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300">{profile.shift || '—'}</p>
              )}
            </Field>
          )}
          <Field label="Phone number">
            {isOwner ? (
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" />
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-300">{phone || '—'}</p>
            )}
          </Field>
          <Field label="Aadhar number">
            {isOwner ? (
              <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            ) : (
              <p className="text-sm text-slate-700 dark:text-slate-300">{idNumber || '—'}</p>
            )}
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Photo">
            <div className="flex items-center gap-3">
              <Avatar name={name} photoPath={photoPath} />
              {isOwner && (
                <div>
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={replacePhoto} />
                  <Button type="button" variant="secondary" onClick={() => photoInputRef.current?.click()}>
                    Replace
                  </Button>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Camera only — can't pick from gallery.</p>
                </div>
              )}
            </div>
          </Field>
          <Field label="Aadhar — front side">
            <div className="flex items-center gap-3">
              {idPhotoFrontPath ? (
                <img src={assetUrl(idPhotoFrontPath)} alt="Aadhar front" className="h-14 w-20 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
              ) : (
                <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-700">None</div>
              )}
              {isOwner && (
                <div>
                  <input ref={idFrontInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={replaceIdFront} />
                  <Button type="button" variant="secondary" onClick={() => idFrontInputRef.current?.click()}>
                    Replace
                  </Button>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Camera only — can't pick from gallery.</p>
                </div>
              )}
            </div>
          </Field>
          <Field label="Aadhar — back side">
            <div className="flex items-center gap-3">
              {idPhotoBackPath ? (
                <img src={assetUrl(idPhotoBackPath)} alt="Aadhar back" className="h-14 w-20 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
              ) : (
                <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-700">None</div>
              )}
              {isOwner && (
                <div>
                  <input ref={idBackInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={replaceIdBack} />
                  <Button type="button" variant="secondary" onClick={() => idBackInputRef.current?.click()}>
                    Replace
                  </Button>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Camera only — can't pick from gallery.</p>
                </div>
              )}
            </div>
          </Field>
        </div>

        {/* §user request — view/print the combined front+back page any time, not just during
            the pending-approval decision (e.g. the owner wants a copy on file). */}
        {isOwner && (idPhotoFrontPath || idPhotoBackPath) && (
          <Button type="button" variant="secondary" className="mt-3" onClick={() => setShowIdReview(true)}>
            📄 View Aadhaar (printable)
          </Button>
        )}

        {isOwner && (
          <>
            <Button className="mt-4" onClick={saveProfile} disabled={busy}>
              Save profile
            </Button>

            {profile.approvalStatus === 'approved' && (
              <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-700">
                <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{profile.hasPinSet ? 'Reset PIN' : 'Set PIN'}</p>
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  {profile.hasPinSet
                    ? "A PIN was already generated automatically on approval — only use this to replace it (lost/forgotten PIN)."
                    : "Only you can mint this — it's what they'll log in with (Property ID + this PIN)."}
                </p>
                <div className="flex items-end gap-2">
                  <Field label="4-digit PIN">
                    <input
                      className={`${inputClass} w-28 text-center tracking-[0.4em]`}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      inputMode="numeric"
                      placeholder="····"
                    />
                  </Field>
                  <Button onClick={savePin} disabled={busy || pin.length !== 4}>
                    {profile.hasPinSet ? 'Reset PIN' : 'Set PIN'}
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-700">
              <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Remove staff</p>
              {removing ? (
                <div>
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                    This revokes their PIN immediately — they won't be able to log in. Their past cleaning/history records stay intact.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setRemoving(false)}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={removeStaff} disabled={busy}>
                      Confirm remove
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setRemoving(true)}>
                  Remove {profile.name}
                </Button>
              )}
            </div>
          </>
        )}
      </CardBody>
      {showIdReview && (
        <AadhaarReviewView
          profile={{ ...profile, idPhotoFrontPath, idPhotoBackPath }}
          busy={busy}
          onClose={() => setShowIdReview(false)}
          onApprove={() => {
            setShowIdReview(false);
            void approve();
          }}
          onStartReject={() => {
            setShowIdReview(false);
            setRejecting(true);
          }}
        />
      )}
    </Card>
  );
}

/** Staff & PINs — owner gets the full roster with photo/status, click into a profile to view
 * everything, approve/reject a pending one, edit details, or mint their PIN. A GM/FMO (manager)
 * reaches this same screen now too (§user request, 2026-10-15 — "ye saara FMO ki ID mein daal
 * do") and sees the same roster, but read-only: approve/reject/PIN-mint/remove/edit stay
 * owner-only, confirmed explicitly. */
export function StaffManagement({ hotelId, token, isOwner }: { hotelId: string; token: string | null; isOwner: boolean }) {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  async function refresh() {
    setStaff(await query<StaffProfile[]>('staff.listAll', { hotelId }, token ?? undefined));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const selected = staff.find((s) => s.id === selectedId);
  if (selected) {
    return (
      <StaffDetail
        token={token}
        profile={selected}
        isOwner={isOwner}
        onClose={() => setSelectedId(null)}
        onChanged={async () => {
          await refresh();
        }}
      />
    );
  }

  const pendingCount = staff.filter((s) => s.approvalStatus === 'pending').length;

  const groups = [
    ...GROUP_ORDER.map((label) => ({ label, members: staff.filter((s) => groupLabel(s) === label) })).filter((g) => g.members.length > 0),
    ...(staff.some((s) => !GROUP_ORDER.includes(groupLabel(s)))
      ? [{ label: 'Other', members: staff.filter((s) => !GROUP_ORDER.includes(groupLabel(s))) }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {showAddForm ? (
        <div>
          <AddStaffForm
            hotelId={hotelId}
            token={token}
            isOwner={isOwner}
            onCreated={() => {
              setShowAddForm(false);
              void refresh();
            }}
          />
          <Button variant="ghost" className="mt-2" onClick={() => setShowAddForm(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Staff"
              subtitle={pendingCount > 0 ? `${pendingCount} profile${pendingCount === 1 ? '' : 's'} awaiting your approval` : 'Every staff profile at this property.'}
            />
            <CardBody>
              {staff.length === 0 ? (
                <EmptyState title="No staff yet" hint="Add your first staff member below." />
              ) : (
                <div className="space-y-6">
                  {groups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {group.label}
                        {group.label === 'Front Office Manager' ? ' (FMO)' : ''}
                        <span className="ml-1.5 font-normal normal-case text-slate-300 dark:text-slate-600">({group.members.length})</span>
                      </p>
                      <div className="space-y-2">
                        {group.members.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSelectedId(s.id)}
                            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/50"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar name={s.name} photoPath={s.photoPath} />
                              <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.name}</p>
                                {(s.shift || s.phone) && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400">{[s.shift, s.phone].filter(Boolean).join(' · ')}</p>
                                )}
                              </div>
                            </div>
                            <Badge tone={STATUS_TONE[s.approvalStatus]}>{s.approvalStatus}</Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* §user request — "new staff appoint karne ka option bottom mein ho". */}
          <Button className="w-full justify-center" onClick={() => setShowAddForm(true)}>
            + Add Staff
          </Button>
        </>
      )}
    </div>
  );
}

import { useRef, useState } from 'react';
import { assetUrl, mutate, uploadFile, ApiError } from '../../api';
import { Button, Card, CardBody, CardHeader, Field, inputClass } from '../../components/ui';
import { DESIGNATION_OPTIONS, SHIFT_OPTIONS } from './designations';

/**
 * §user request — a full staff profile (photo, phone, Aadhar), not just a name+PIN. A GM/FMO
 * fills this in and it goes to the owner for approval; an owner filling it in themselves skips
 * approval (there's no one else to approve it) and can set the PIN right after.
 */
export function AddStaffForm({
  hotelId,
  token,
  isOwner,
  onCreated,
}: {
  hotelId: string;
  token: string | null;
  isOwner: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState(DESIGNATION_OPTIONS[2].designation); // Housekeeping Staff
  const [shift, setShift] = useState(SHIFT_OPTIONS[0]);
  const [phone, setPhone] = useState('');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [idNumber, setIdNumber] = useState('');
  const [idPhotoPath, setIdPhotoPath] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingId, setUploadingId] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const idInputRef = useRef<HTMLInputElement>(null);
  const selectedRole = DESIGNATION_OPTIONS.find((d) => d.designation === designation)?.role ?? 'housekeeping';

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/staff-photo', file, token ?? undefined);
      setPhotoPath(result.filePath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleIdUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingId(true);
    setError(null);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/staff-id', file, token ?? undefined);
      setIdPhotoPath(result.filePath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aadhar upload failed');
    } finally {
      setUploadingId(false);
    }
  }

  function reset() {
    setName('');
    setDesignation(DESIGNATION_OPTIONS[2].designation);
    setShift(SHIFT_OPTIONS[0]);
    setPhone('');
    setPhotoPath(null);
    setIdNumber('');
    setIdPhotoPath(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const role = selectedRole;
    try {
      await mutate(
        'staff.propose',
        {
          hotelId,
          name,
          role,
          designation,
          shift: role === 'housekeeping' ? shift : undefined,
          phone: phone || undefined,
          photoPath: photoPath || undefined,
          idNumber: idNumber || undefined,
          idPhotoPath: idPhotoPath || undefined,
        },
        token ?? undefined,
      );
      setMessage(
        isOwner
          ? `${name} added — set a PIN for them below in the staff list.`
          : `${name}'s profile submitted — it'll show up once the owner approves it.`,
      );
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Add Staff"
        subtitle={isOwner ? 'Fill in their profile — this goes live immediately.' : "Fill in their profile — it'll need the owner's approval before they can log in."}
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          {message && <p className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={designation} onChange={(e) => setDesignation(e.target.value)}>
                {DESIGNATION_OPTIONS.map((d) => (
                  <option key={d.designation} value={d.designation}>
                    {d.designation}
                  </option>
                ))}
              </select>
            </Field>
            {selectedRole === 'housekeeping' && (
              <Field label="Shift">
                <select className={inputClass} value={shift} onChange={(e) => setShift(e.target.value)}>
                  {SHIFT_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Phone number">
              <input
                className={inputClass}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                placeholder="10-digit mobile number"
              />
            </Field>
            <Field label="Aadhar number">
              <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="XXXX XXXX XXXX" />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Photo">
              <div className="flex items-center gap-3">
                {photoPath ? (
                  <img src={assetUrl(photoPath)} alt="Staff" className="h-14 w-14 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400 dark:bg-slate-700">No photo</div>
                )}
                <div>
                  <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
                  <Button type="button" variant="secondary" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
                    {uploadingPhoto ? 'Uploading…' : photoPath ? 'Replace photo' : 'Upload photo'}
                  </Button>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Camera only — can't pick from gallery.</p>
                </div>
              </div>
            </Field>
            <Field label="Aadhar card photo">
              <div className="flex items-center gap-3">
                {idPhotoPath ? (
                  <img src={assetUrl(idPhotoPath)} alt="Aadhar" className="h-14 w-20 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-600" />
                ) : (
                  <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-700">No photo</div>
                )}
                <div>
                  <input ref={idInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleIdUpload} />
                  <Button type="button" variant="secondary" onClick={() => idInputRef.current?.click()} disabled={uploadingId}>
                    {uploadingId ? 'Uploading…' : idPhotoPath ? 'Replace' : 'Upload Aadhar'}
                  </Button>
                  <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Camera only — can't pick from gallery.</p>
                </div>
              </div>
            </Field>
          </div>

          <Button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? 'Submitting…' : isOwner ? 'Add staff member' : 'Submit for approval'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

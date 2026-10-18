import { useEffect, useRef, useState } from 'react';
import { assetUrl, mutate, query, uploadFile, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Card, EmptyState, inputClass } from '../components/ui';
import type { RoomCategoryDetail } from '../types';

const ROOM_TYPES = ['Standard', 'Deluxe', 'Super Deluxe', 'Luxury', 'Suite', 'Executive'];
const ROOM_VIEWS = ['No View', 'City View', 'Garden View', 'Pool View', 'Sea View', 'Mountain View', 'Courtyard View'];
const BED_TYPES = ['1 Single Bed', '2 Single Beds', '1 Double Bed', '1 Queen Bed', '1 King Bed', '2 Twin Beds', '1 King Bed + 1 Sofa Bed'];
const AMENITY_CATALOG = [
  'Air Conditioning', 'Free WiFi', 'Television', 'Minibar', 'Balcony', 'Room Service',
  'In-room Safe', 'Hairdryer', 'Iron & Board', 'Tea/Coffee Maker', 'Bathtub', 'Work Desk',
  'Refrigerator', 'Heating', 'Wardrobe', 'Daily Housekeeping', 'Wake-up Service', 'Soundproofing',
];

/** Mirrors a reference OTA extranet's per-room "Room Details" page (§ user request) — each card
 * is independently editable, and nothing here touches physical Room inventory (managed elsewhere). */
export function RoomDetailView({ roomCategoryId, onBack }: { roomCategoryId: string; onBack: () => void }) {
  const { token } = useAuth();
  const [detail, setDetail] = useState<RoomCategoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setDetail(await query<RoomCategoryDetail>('hotels.getRoomCategoryDetail', { roomCategoryId }, token ?? undefined));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCategoryId]);

  async function save(fields: Record<string, unknown>) {
    setError(null);
    try {
      await mutate('hotels.updateRoomCategory', { roomCategoryId, ...fields }, token ?? undefined);
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
      return false;
    }
  }

  if (!detail) return null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
        <button onClick={onBack} className="font-medium text-brand-600 hover:underline">
          Room Setup
        </button>
        <span>›</span>
        <span className="text-slate-500">{detail.name}</span>
      </div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{detail.name}</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-5">
        <RoomDetailsCard detail={detail} onSave={save} />
        <OccupancyCard detail={detail} onSave={save} />
        <BathroomCard detail={detail} onSave={save} />
        <AmenitiesCard detail={detail} onSave={save} />
        <PhotosCard detail={detail} token={token} onChanged={refresh} />
      </div>
    </div>
  );
}

function SectionCard({
  title,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  children,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {editing ? (
          <div className="flex gap-3">
            <button onClick={onCancel} className="text-sm font-medium text-slate-400 hover:text-slate-600">
              Cancel
            </button>
            <button onClick={onSave} disabled={saving} className="text-sm font-semibold text-brand-600 hover:underline disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button onClick={onEdit} className="text-sm font-semibold text-brand-600 hover:underline">
            Edit
          </button>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

function RoomDetailsCard({ detail, onSave }: { detail: RoomCategoryDetail; onSave: (f: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(detail.name);
  const [roomType, setRoomType] = useState(detail.roomType ?? '');
  const [roomView, setRoomView] = useState(detail.roomView ?? '');
  const [roomSizeSqft, setRoomSizeSqft] = useState(detail.roomSizeSqft ?? '');
  const [description, setDescription] = useState(detail.description ?? '');

  function startEdit() {
    setName(detail.name);
    setRoomType(detail.roomType ?? '');
    setRoomView(detail.roomView ?? '');
    setRoomSizeSqft(detail.roomSizeSqft ?? '');
    setDescription(detail.description ?? '');
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    const ok = await onSave({
      name: name.trim(),
      roomType: roomType || undefined,
      roomView: roomView || undefined,
      roomSizeSqft: roomSizeSqft ? Number(roomSizeSqft) : undefined,
      description: description.trim() || undefined,
    });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <SectionCard title="Room Details" editing={editing} onEdit={startEdit} onCancel={() => setEditing(false)} onSave={() => void handleSave()} saving={saving}>
      {editing ? (
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs text-slate-500">Room Name (as displayed on MakeMyTrip &amp; partner websites)</p>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="mb-1 text-xs text-slate-500">Room type</p>
              <select className={inputClass} value={roomType} onChange={(e) => setRoomType(e.target.value)}>
                <option value="">Select</option>
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs text-slate-500">Room view</p>
              <select className={inputClass} value={roomView} onChange={(e) => setRoomView(e.target.value)}>
                <option value="">Select</option>
                {ROOM_VIEWS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs text-slate-500">Room Size (sq ft)</p>
              <input className={inputClass} type="number" min={0} value={roomSizeSqft} onChange={(e) => setRoomSizeSqft(e.target.value ? Number(e.target.value) : '')} />
            </div>
            <div>
              <p className="mb-1 text-xs text-slate-500">Number of rooms</p>
              <input className={`${inputClass} bg-slate-50 text-slate-400`} value={detail.roomCount} disabled title="Managed from Staff & Setup → Rooms" />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Description (optional)</p>
            <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-500">Room Name (as displayed on MakeMyTrip &amp; partner websites)</p>
            <p className="text-sm font-semibold text-slate-900">{detail.name}</p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Room type" value={detail.roomType ?? '—'} />
            <Stat label="Room view" value={detail.roomView ?? '—'} />
            <Stat label="Number of rooms (of this type)" value={String(detail.roomCount)} />
            <Stat label="Room Size" value={detail.roomSizeSqft ? `${detail.roomSizeSqft} Square Feet` : '—'} />
          </div>
          {detail.description && (
            <div>
              <p className="text-xs text-slate-500">Description</p>
              <p className="text-sm text-slate-700">{detail.description}</p>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function OccupancyCard({ detail, onSave }: { detail: RoomCategoryDetail; onSave: (f: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bedType, setBedType] = useState(detail.bedType ?? '');
  const [maxOccupancy, setMaxOccupancy] = useState(detail.maxOccupancy ?? '');

  function startEdit() {
    setBedType(detail.bedType ?? '');
    setMaxOccupancy(detail.maxOccupancy ?? '');
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    const ok = await onSave({ bedType: bedType || undefined, maxOccupancy: maxOccupancy ? Number(maxOccupancy) : undefined });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <SectionCard title="Sleeping Arrangement & Occupancy" editing={editing} onEdit={startEdit} onCancel={() => setEditing(false)} onSave={() => void handleSave()} saving={saving}>
      {editing ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-xs text-slate-500">Beds available in the room</p>
            <select className={inputClass} value={bedType} onChange={(e) => setBedType(e.target.value)}>
              <option value="">Select</option>
              {BED_TYPES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Maximum Occupancy</p>
            <input className={inputClass} type="number" min={1} value={maxOccupancy} onChange={(e) => setMaxOccupancy(e.target.value ? Number(e.target.value) : '')} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Beds available in the room" value={detail.bedType ?? '—'} />
          <Stat label="Maximum Occupancy" value={detail.maxOccupancy != null ? String(detail.maxOccupancy) : '—'} />
        </div>
      )}
    </SectionCard>
  );
}

function BathroomCard({ detail, onSave }: { detail: RoomCategoryDetail; onSave: (f: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bathroomCount, setBathroomCount] = useState(detail.bathroomCount ?? 1);

  function startEdit() {
    setBathroomCount(detail.bathroomCount ?? 1);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    const ok = await onSave({ bathroomCount: Number(bathroomCount) });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <SectionCard title="Bathroom Details" editing={editing} onEdit={startEdit} onCancel={() => setEditing(false)} onSave={() => void handleSave()} saving={saving}>
      {editing ? (
        <div className="max-w-[160px]">
          <p className="mb-1 text-xs text-slate-500">Bathroom available</p>
          <input className={inputClass} type="number" min={1} value={bathroomCount} onChange={(e) => setBathroomCount(Number(e.target.value))} />
        </div>
      ) : (
        <Stat label="Bathroom available" value={detail.bathroomCount != null ? String(detail.bathroomCount) : '—'} />
      )}
    </SectionCard>
  );
}

function AmenitiesCard({ detail, onSave }: { detail: RoomCategoryDetail; onSave: (f: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>(detail.amenities);

  function startEdit() {
    setSelected(detail.amenities);
    setEditing(true);
  }

  function toggle(a: string) {
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  async function handleSave() {
    setSaving(true);
    const ok = await onSave({ amenities: selected });
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <SectionCard title="Amenity Details" editing={editing} onEdit={startEdit} onCancel={() => setEditing(false)} onSave={() => void handleSave()} saving={saving}>
      {editing ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
          {AMENITY_CATALOG.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={selected.includes(a)}
                onChange={() => toggle(a)}
              />
              {a}
            </label>
          ))}
        </div>
      ) : (
        <div>
          <p className="text-xs text-slate-500">Amenities added</p>
          <p className="mb-2 text-sm font-semibold text-slate-900">
            {detail.amenities.length} amenit{detail.amenities.length === 1 ? 'y' : 'ies'}
          </p>
          {detail.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detail.amenities.map((a) => (
                <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function PhotosCard({ detail, token, onChanged }: { detail: RoomCategoryDetail; token: string | null; onChanged: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadFile<{ filePath: string }>('uploads/room-photo', file, token ?? undefined);
        await mutate('hotels.addRoomPhoto', { roomCategoryId: detail.id, filePath: result.filePath }, token ?? undefined);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removePhoto(photoId: string) {
    await mutate('hotels.removeRoomPhoto', { photoId }, token ?? undefined);
    onChanged();
  }

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-base font-bold text-slate-900">Photos &amp; Videos</h2>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-sm font-semibold text-brand-600 hover:underline disabled:opacity-50">
          {uploading ? 'Uploading…' : '+ Add Photos'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
      </div>
      <div className="px-5 py-4">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {detail.photos.length === 0 ? (
          <EmptyState title="No photos yet" hint="Add photos so guests know what this room looks like." />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {detail.photos.map((p) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                <img src={assetUrl(p.filePath)} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => void removePhoto(p.id)}
                  className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-xs text-white group-hover:flex"
                  title="Remove photo"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { assetUrl, mutate, query, uploadFile, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, EmptyState } from '../components/ui';
import { StepTabs } from './ListingWizardTabs';
import type { HotelPhoto } from '../types';

/** "List Your Property" step 6 — property-level gallery, same upload pattern as the
 * Room Details page's Photos & Videos card, just scoped to the hotel instead of a room. */
export function PhotosAndVideosStep({
  hotelId,
  onContinue,
  onBack,
}: {
  hotelId: string;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { token } = useAuth();
  const [photos, setPhotos] = useState<HotelPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setPhotos(await query<HotelPhoto[]>('hotels.listHotelPhotos', { hotelId }, token ?? undefined));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadFile<{ filePath: string }>('uploads/hotel-photo', file, token ?? undefined);
        await mutate('hotels.addHotelPhoto', { hotelId, filePath: result.filePath }, token ?? undefined);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removePhoto(photoId: string) {
    await mutate('hotels.removeHotelPhoto', { photoId }, token ?? undefined);
    await refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <StepTabs current={6} />
      <div className="mx-auto w-full max-w-3xl flex-1 px-10 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Photos And Videos</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Add photos of your property to attract more guests. You can add more later.</p>

        <div className="mb-6 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Property Photos</h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-sm font-semibold text-brand-600 hover:underline disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : '+ Add Photos'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
          <div className="px-6 py-5">
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            {photos.length === 0 ? (
              <EmptyState title="No photos yet" hint="Add a few photos so guests know what your property looks like." />
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {photos.map((p) => (
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
        </div>

        <div className="flex items-center justify-between pb-8">
          <Button type="button" variant="ghost" onClick={onBack}>
            ← Back
          </Button>
          <Button type="button" onClick={onContinue}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

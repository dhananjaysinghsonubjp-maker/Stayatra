import { assetUrl } from '../../api';
import { Button } from '../../components/ui';
import type { StaffProfile } from '../../types';

/**
 * §user request — "front and back ek single page mein dikhe jo printable rahega, owner dekh ke
 * approve ya reject kar sake": FMO uploads Aadhaar front/back as two separate photos
 * (AddStaffForm), which used to only ever show up as two small thumbnails buried in the edit
 * form. This combines them onto one clean, print-ready page — reference was an actual Aadhaar
 * scan, front card then back card stacked — with the owner's Approve/Reject right there instead
 * of having to go back to the edit form for that decision.
 *
 * Same print isolation pattern as InvoicePrintView (`.staff-id-print-root`/`.no-print` in
 * index.css) — `window.print()` only, no PDF library; "Save as PDF" in that dialog covers
 * downloading.
 */
export function AadhaarReviewView({
  profile,
  busy,
  onClose,
  onApprove,
  onStartReject,
}: {
  profile: StaffProfile;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onStartReject: () => void;
}) {
  return (
    <div className="staff-id-print-root fixed inset-0 z-[70] overflow-y-auto bg-slate-900/50 print:bg-white">
      <div className="mx-auto my-8 max-w-xl rounded-xl bg-white p-8 shadow-xl print:my-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <div className="no-print mb-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">ID Review</h3>
          <button onClick={onClose} className="text-xs font-medium text-slate-500 hover:underline">
            ← Back to profile
          </button>
        </div>

        <div className="mb-6 text-center">
          <h2 className="text-lg font-bold text-slate-900">{profile.name}</h2>
          <p className="text-sm text-slate-500">
            {profile.designation}
            {profile.idNumber ? ` · Aadhaar ${profile.idNumber}` : ''}
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Front</p>
            {profile.idPhotoFrontPath ? (
              <img
                src={assetUrl(profile.idPhotoFrontPath)}
                alt="Aadhaar front"
                className="w-full rounded-lg border border-slate-200 object-contain"
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
                No front photo uploaded
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Back</p>
            {profile.idPhotoBackPath ? (
              <img
                src={assetUrl(profile.idPhotoBackPath)}
                alt="Aadhaar back"
                className="w-full rounded-lg border border-slate-200 object-contain"
              />
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
                No back photo uploaded
              </div>
            )}
          </div>
        </div>

        <div className="no-print mt-7 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => window.print()}>
            🖨 Print
          </Button>
          {profile.approvalStatus === 'pending' && (
            <>
              <Button type="button" onClick={onApprove} disabled={busy} className="!bg-emerald-600 hover:!bg-emerald-700">
                ✓ Approve
              </Button>
              <Button type="button" variant="danger" onClick={onStartReject} disabled={busy}>
                ✕ Reject
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

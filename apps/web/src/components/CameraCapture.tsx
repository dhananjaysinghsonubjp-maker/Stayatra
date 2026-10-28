import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui';

/**
 * §user request — "real time image bhi click kar sakte, ye add-on zaroor hona chahiye": a live
 * camera viewfinder (not just the OS's own camera app via a file input's capture attribute) so
 * ID photos can be taken directly in the browser, on a phone's back camera or a laptop's webcam.
 * Pure browser APIs (getUserMedia + canvas) — nothing server-side, same File shape a normal
 * upload would hand the caller either way.
 */
export function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        let stream: MediaStream;
        try {
          // Back camera on a phone — best for a document photo. Most laptops have no
          // "environment" camera, so that request fails there and this falls back to
          // whatever default camera is available (the webcam).
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        if (!cancelled) setError('Could not access the camera — check browser/site permissions and try again.');
      }
    }
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `id-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }

  // Portal to <body> — opened from inside a slide-over panel that itself has a CSS transform
  // (its slide animation), which would otherwise make this `fixed` only cover that panel's own
  // box instead of the real viewport (a transformed ancestor becomes the containing block for
  // `fixed` descendants).
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-4">
      <div className="flex w-full max-w-sm flex-col items-center overflow-hidden rounded-xl bg-black">
        {error ? (
          <p className="p-8 text-center text-sm text-white">{error}</p>
        ) : (
          <video ref={videoRef} playsInline muted className="w-full" />
        )}
      </div>
      <div className="mt-5 flex gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {!error && (
          <Button type="button" variant="royal" onClick={capture} disabled={!ready}>
            📷 Capture
          </Button>
        )}
      </div>
    </div>,
    document.body,
  );
}

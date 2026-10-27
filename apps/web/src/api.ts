// Thin fetch wrapper against the tRPC HTTP endpoints. This is a test-harness
// client for the simulator, not the typed tRPC client the real web app would
// use — kept deliberately simple so the simulator has no build-time coupling
// to apps/api's internals.
//
// §deploy — frontend and backend used to always share one origin (same-domain
// reverse proxy), so every API/asset URL in this app was written as a plain
// relative path ('/trpc/...', '/uploads/...'). Splitting them across two
// hosts (e.g. Vercel + Railway) breaks every one of those unless they're
// resolved against the backend's own origin instead. VITE_API_URL (set at
// build time, e.g. https://your-app.up.railway.app) makes that origin
// explicit; left unset, API_ORIGIN is '' and every path below still resolves
// relative to whatever origin served the page — the original same-origin
// behavior, unchanged for local dev or a future same-domain deploy.
export const API_ORIGIN = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
const BASE = `${API_ORIGIN}/trpc`;

/** Resolves an uploaded-file path (e.g. a hotel logo or ID photo, as stored
 * on a Booking/Hotel/User row) against the backend's own origin — use this
 * instead of a raw `src={`/${path}`}` wherever one of those paths is rendered. */
export function assetUrl(path: string | null | undefined): string {
  return path ? `${API_ORIGIN}/${path}` : '';
}

export class ApiError extends Error {}

export async function query<T = unknown>(path: string, input: unknown, token?: string): Promise<T> {
  const url = `${BASE}/${path}?input=${encodeURIComponent(JSON.stringify(input ?? {}))}`;
  const res = await fetch(url, { headers: authHeader(token) });
  return unwrap<T>(res);
}

export async function mutate<T = unknown>(path: string, input: unknown, token?: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(input ?? {}),
  });
  return unwrap<T>(res);
}

function authHeader(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (json.error) throw new ApiError(friendlyErrorMessage(json.error.message ?? 'Request failed'));
  return json.result.data as T;
}

// tRPC surfaces a Zod validation failure as `error.message` being the
// stringified issues array (e.g. `[{"path":["guestPhone"],"message":"..."}]`)
// rather than prose. Shown as-is that's unreadable, so turn it into
// "Field: problem" text; anything else (a plain thrown message) passes through.
function friendlyErrorMessage(raw: string): string {
  try {
    const issues = JSON.parse(raw);
    if (Array.isArray(issues) && issues.length > 0 && issues[0]?.path) {
      return issues
        .map((issue: { path?: unknown[]; message?: string; pattern?: string }) => {
          const field = Array.isArray(issue.path) && issue.path.length ? fieldLabel(String(issue.path[issue.path.length - 1])) : null;
          const isTenDigitPhone = typeof issue.pattern === 'string' && issue.pattern.includes('d{10}');
          const detail = isTenDigitPhone ? 'must be exactly 10 digits' : issue.message ?? 'invalid value';
          return field ? `${field}: ${detail}` : detail;
        })
        .join('; ');
    }
  } catch {
    // Not JSON — a normal thrown message, use as-is.
  }
  return raw;
}

function fieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// Outside tRPC (multipart) — see apps/api/src/id-extraction/id-scan.controller.ts.
export async function uploadFile<T = unknown>(path: string, file: File, token?: string): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_ORIGIN}/${path}`, { method: 'POST', headers: authHeader(token), body: form });
  const json = await res.json();
  if (!res.ok) throw new ApiError(json.message ?? 'Upload failed');
  return json as T;
}

// Thin fetch wrapper against the tRPC HTTP endpoints. This is a test-harness
// client for the simulator, not the typed tRPC client the real web app would
// use — kept deliberately simple so the simulator has no build-time coupling
// to apps/api's internals.
const BASE = '/trpc';

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
  if (json.error) throw new ApiError(json.error.message ?? 'Request failed');
  return json.result.data as T;
}

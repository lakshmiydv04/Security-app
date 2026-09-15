/**
 * Browser API client.
 *
 * Token handling, and an honest note about it:
 *
 *   The access token is held in memory only. The refresh token goes to
 *   localStorage because the backend returns tokens in the response body
 *   rather than setting cookies, so there is nowhere better to put it from
 *   the browser's side. localStorage is readable by any XSS on this origin.
 *
 *   The real fix is a backend change: have /api/auth/* set the refresh token
 *   as an httpOnly, Secure, SameSite=Strict cookie and stop returning it in
 *   the body. Until then this is the least-bad option, not a good one, and it
 *   should not ship to production as-is. See README.
 *
 * Concurrent 401s share one refresh promise: the backend treats a replayed
 * refresh token as theft and revokes the whole family, so parallel rotations
 * would log the user out.
 */

const BASE = (process.env.NEXT_PUBLIC_GUARDIAN_API_URL ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

const REFRESH_KEY = 'guardian.refreshToken';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function onAuthChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(signedIn: boolean): void {
  listeners.forEach((fn) => fn(signedIn));
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function readRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  if (typeof window !== 'undefined') {
    try {
      if (tokens) window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
      else window.localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* storage disabled: session lasts until reload */
    }
  }
  announce(Boolean(tokens));
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, code, message);
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    setTokens(null);
    return null;
  }

  const next = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokens(next);
  return next.accessToken;
}

function refreshOnce(): Promise<string | null> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Restores a session from the stored refresh token on first load. */
export async function restoreSession(): Promise<boolean> {
  if (accessToken) return true;
  if (!readRefreshToken()) return false;
  return (await refreshOnce()) !== null;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const send = (token: string | null): Promise<Response> =>
    fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  let res = await send(auth ? accessToken : null);

  if (res.status === 401 && auth) {
    const rotated = await refreshOnce();
    if (!rotated) {
      setTokens(null);
      throw await toApiError(res);
    }
    res = await send(rotated);
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const API_BASE_URL = BASE;

/**
 * REST client.
 *
 * Handles bearer auth and one transparent refresh-and-retry on a 401.
 * Concurrent 401s share a single refresh promise so a burst of requests
 * cannot rotate the refresh token several times in parallel - the backend
 * treats a replayed refresh token as theft and kills the whole family.
 */

import { API_BASE_URL } from '../config';
import type { ApiErrorBody } from './types';

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

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

type TokenReader = () => TokenPair | null;
type TokenWriter = (tokens: TokenPair | null) => void | Promise<void>;

let readTokens: TokenReader = () => null;
let writeTokens: TokenWriter = () => {};
let refreshInFlight: Promise<TokenPair | null> | null = null;

export function configureApi(reader: TokenReader, writer: TokenWriter): void {
  readTokens = reader;
  writeTokens = writer;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, code, message);
}

async function refresh(): Promise<TokenPair | null> {
  const current = readTokens();
  if (!current?.refreshToken) return null;

  const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });

  if (!res.ok) {
    await writeTokens(null);
    return null;
  }

  const next = (await res.json()) as TokenPair;
  await writeTokens(next);
  return next;
}

/** Single-flight refresh: parallel 401s wait on one rotation, not several. */
function refreshOnce(): Promise<TokenPair | null> {
  refreshInFlight ??= refresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * No request may hang forever.
 *
 * fetch() has no default timeout. A request that never settles leaves the UI
 * stuck mid-action - and on the privacy screen the switch is replaced by a
 * spinner while a change is in flight, so a hung request makes the control
 * appear simply not to work, with no way to tell whether the toggle took
 * effect. On a safety control that is the worst failure mode there is.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  caller?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const relayAbort = (): void => controller.abort();
  caller?.addEventListener('abort', relayAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Distinguish our timeout from a caller-initiated cancellation.
    if (controller.signal.aborted && caller?.aborted !== true) {
      throw new ApiError(
        0,
        'TIMEOUT',
        'No reply from the server after ' + DEFAULT_TIMEOUT_MS / 1000 + ' seconds.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', relayAbort);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const send = async (token?: string): Promise<Response> =>
    fetchWithTimeout(
      `${API_BASE_URL}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      signal,
    );

  let res = await send(auth ? readTokens()?.accessToken : undefined);

  if (res.status === 401 && auth) {
    const rotated = await refreshOnce();
    if (!rotated) throw await parseError(res);
    res = await send(rotated.accessToken);
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

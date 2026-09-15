import { request } from './client';
import type {
  AuthResponse,
  PairingSummary,
  PrivacyChannel,
  PrivacySnapshotResponse,
} from './types';

export const authApi = {
  register: (email: string, password: string, displayName: string) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { email, password, displayName },
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    }),

  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
};

export const pairingApi = {
  list: () => request<{ pairings: PairingSummary[] }>('/api/pairings'),

  redeem: (code: string) =>
    request<{ pairingId: string; status: 'PENDING' }>('/api/pairings/invites/redeem', {
      method: 'POST',
      body: { code },
    }),

  /** Either party, no approval needed from the other. */
  revoke: (pairingId: string, reason?: string) =>
    request<{ status: 'REVOKED' }>(`/api/pairings/${pairingId}/revoke`, {
      method: 'POST',
      body: { reason: reason ?? null },
    }),

  setTier: (pairingId: string, tier: 'SELF_MANAGED' | 'GUARDIAN_MANAGED') =>
    request<{ tier: string }>(`/api/pairings/${pairingId}/tier`, {
      method: 'PATCH',
      body: { tier },
    }),
};

export const privacyApi = {
  get: (pairingId: string) =>
    request<PrivacySnapshotResponse>(`/api/pairings/${pairingId}/privacy`),

  setChannel: (pairingId: string, channel: PrivacyChannel, enabled: boolean) =>
    request<{ channel: PrivacyChannel; enabled: boolean }>(
      `/api/pairings/${pairingId}/privacy`,
      { method: 'PATCH', body: { channel, enabled } },
    ),

  /** The master kill switch. Applies across every connection at once. */
  setMasterShield: (active: boolean) =>
    request<{ masterShieldActive: boolean }>('/api/me/master-shield', {
      method: 'PUT',
      body: { active },
    }),
};

export const locationApi = {
  push: (
    pairingId: string,
    point: { lat: number; lng: number; accuracyMeters?: number; capturedAt?: string },
  ) => request<unknown>(`/api/pairings/${pairingId}/location`, { method: 'POST', body: point }),
};

export const sosApi = {
  /**
   * Panic button. Deliberately NOT gated by the local privacy state - the
   * backend accepts SOS with the shield up, because that is exactly when it
   * matters most. Never add a client-side guard here.
   */
  trigger: (point?: { lat: number; lng: number; accuracyMeters?: number }) =>
    request<{ notifiedGuardians: number }>('/api/sos', {
      method: 'POST',
      body: point ?? {},
    }),
};

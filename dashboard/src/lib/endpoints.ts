import { api } from './api';
import type {
  AuditEvent,
  AuthResponse,
  ChainVerification,
  GeofenceEvent,
  GeofenceZone,
  LatestLocationResponse,
  LocationPing,
  PairingSummary,
  PrivacyChannel,
  PrivacySnapshotResponse,
  SensorKind,
  SensorSession,
} from './types';

export const authApi = {
  login: (email: string, password: string) =>
    api<AuthResponse>('/api/auth/login', { method: 'POST', auth: false, body: { email, password } }),
  register: (email: string, password: string, displayName: string) =>
    api<AuthResponse>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { email, password, displayName },
    }),
  logout: () => api<void>('/api/auth/logout', { method: 'POST' }),
};

export const pairingApi = {
  list: () => api<{ pairings: PairingSummary[] }>('/api/pairings'),
  createInvite: () =>
    api<{ code: string; expiresAt: string }>('/api/pairings/invites', { method: 'POST' }),
  /** Second half of the handshake, after the monitored user redeems the code. */
  confirm: (pairingId: string) =>
    api<{ status: 'ACTIVE' }>(`/api/pairings/${pairingId}/confirm`, { method: 'POST' }),
  revoke: (pairingId: string, reason?: string) =>
    api<{ status: 'REVOKED' }>(`/api/pairings/${pairingId}/revoke`, {
      method: 'POST',
      body: { reason: reason ?? null },
    }),
};

export const privacyApi = {
  get: (pairingId: string) =>
    api<PrivacySnapshotResponse>(`/api/pairings/${pairingId}/privacy`),
  setLocks: (pairingId: string, locks: PrivacyChannel[]) =>
    api<{ locks: PrivacyChannel[] }>(`/api/pairings/${pairingId}/locks`, {
      method: 'PUT',
      body: { locks },
    }),
};

export const sensorApi = {
  request: (pairingId: string, kind: SensorKind) =>
    api<{ session: SensorSession; forcedByGuardianLock: boolean; mediaToken: null }>(
      `/api/pairings/${pairingId}/sensor-sessions`,
      { method: 'POST', body: { kind } },
    ),
  end: (sessionId: string) =>
    api<{ status: 'ENDED' }>(`/api/sensor-sessions/${sessionId}/end`, { method: 'POST' }),
  list: (pairingId: string) =>
    api<{ sessions: SensorSession[] }>(`/api/pairings/${pairingId}/sensor-sessions`),
};

export const locationApi = {
  latest: (pairingId: string) =>
    api<LatestLocationResponse>(`/api/pairings/${pairingId}/location/latest`),
  history: (pairingId: string, limit = 100) =>
    api<{ pings: LocationPing[] }>(`/api/pairings/${pairingId}/location/history?limit=${limit}`),
};

export const geofenceApi = {
  list: (pairingId: string) =>
    api<{ zones: GeofenceZone[] }>(`/api/pairings/${pairingId}/geofences`),
  create: (
    pairingId: string,
    zone: {
      name: string;
      centerLat: number;
      centerLng: number;
      radiusMeters: number;
      notifyOnEnter: boolean;
      notifyOnExit: boolean;
    },
  ) => api<{ zone: GeofenceZone }>(`/api/pairings/${pairingId}/geofences`, {
    method: 'POST',
    body: zone,
  }),
  remove: (pairingId: string, zoneId: string) =>
    api<void>(`/api/pairings/${pairingId}/geofences/${zoneId}`, { method: 'DELETE' }),
  events: (pairingId: string) =>
    api<{ events: GeofenceEvent[] }>(`/api/pairings/${pairingId}/geofence-events`),
};

export const sosApi = {
  acknowledge: (alertId: string) =>
    api<{ alert: unknown }>(`/api/sos/${alertId}/acknowledge`, { method: 'POST' }),
};

export const auditApi = {
  list: (pairingId: string, limit = 200) =>
    api<{ events: AuditEvent[] }>(`/api/pairings/${pairingId}/audit?limit=${limit}`),
  verify: () => api<ChainVerification>('/api/audit/verify'),
};

export interface IceConfig {
  iceServers: RTCIceServer[];
  /** False when no TURN relay is configured, so a strict network may fail. */
  turnConfigured: boolean;
}

export const rtcApi = {
  /** Fresh, short-lived ICE credentials. Minted per call; never cached. */
  ice: () => api<IceConfig>('/api/rtc/ice'),
};

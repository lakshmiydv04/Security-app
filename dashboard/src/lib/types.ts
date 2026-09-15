/**
 * Wire contracts, mirrored by hand from server/src/domain and the route
 * handlers. Hand-written rather than generated so a breaking backend change
 * shows up here as a type error instead of a runtime surprise.
 */

export type PrivacyChannel = 'LOCATION' | 'CAMERA' | 'MICROPHONE';
export type PairingStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';
export type PairingTier = 'SELF_MANAGED' | 'GUARDIAN_MANAGED';
export type SensorKind = 'CAMERA' | 'MICROPHONE';
export type ActorRole = 'GUARDIAN' | 'MONITORED' | 'SYSTEM';
export type AuditOutcome = 'ALLOWED' | 'DENIED' | 'INFO';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface PrivacySnapshot {
  pairingStatus: PairingStatus;
  tier: PairingTier;
  masterShieldActive: boolean;
  locationEnabled: boolean;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  guardianLockedChannels: PrivacyChannel[];
}

export interface PrivacySnapshotResponse extends PrivacySnapshot {
  userControllableChannels: PrivacyChannel[];
}

export interface PairingSummary {
  id: string;
  status: PairingStatus;
  tier: PairingTier;
  role: 'GUARDIAN' | 'MONITORED';
  guardian: { id: string; displayName: string };
  monitoredUser: { id: string; displayName: string };
  privacy: {
    location: boolean;
    camera: boolean;
    microphone: boolean;
    guardianLockedChannels: PrivacyChannel[];
    masterShieldActive: boolean;
  } | null;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
}

export interface LocationPing {
  id: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  capturedAt: string;
}

export interface LatestLocationResponse {
  latest: LocationPing | null;
  sharingActive: boolean;
  reason?: string;
}

export interface GeofenceZone {
  id: string;
  pairingId: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
  active: boolean;
  createdAt: string;
}

export interface GeofenceEvent {
  id: string;
  zoneId: string;
  type: 'ENTER' | 'EXIT';
  lat: number;
  lng: number;
  occurredAt: string;
  zone: { name: string };
}

export interface SensorSession {
  id: string;
  kind: SensorKind;
  status: 'REQUESTED' | 'DENIED' | 'ACTIVE' | 'ENDED';
  roomName: string | null;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  denialReason: string | null;
}

export interface AuditEvent {
  seq: string;
  action: string;
  channel: PrivacyChannel | null;
  outcome: AuditOutcome;
  reason: string | null;
  actorRole: ActorRole;
  actorUserId: string | null;
  metadata: unknown;
  occurredAt: string;
}

export type ChainVerification =
  | { valid: true; length: number }
  | { valid: false; length: number; brokenAtSeq: string; problem: 'HASH_MISMATCH' | 'CHAIN_BREAK' };

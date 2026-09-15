/**
 * Wire contracts shared with the backend (server/src/domain/privacy.ts).
 * Kept as a hand-written mirror rather than generated, so a backend change
 * that breaks the contract shows up as a type error here.
 */

export type PrivacyChannel = 'LOCATION' | 'CAMERA' | 'MICROPHONE';
export type PairingStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';
export type PairingTier = 'SELF_MANAGED' | 'GUARDIAN_MANAGED';

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

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

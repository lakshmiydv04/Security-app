/**
 * Server-authoritative privacy enforcement.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The original design put the privacy check in the mobile app's local state
 * controller. That is not a security boundary: a repackaged build simply
 * removes the check and the guardian keeps streaming. The device-side toggle
 * is retained as a latency optimisation and as the user's control surface, but
 * THIS is the enforcement point. Every command route and every media-token
 * mint must pass through `evaluatePrivacy`.
 *
 * THE TIER DECISION
 * -----------------
 * The hardest call in the product is who holds the kill switch when the
 * monitored person is a young child. Resolution encoded here:
 *
 *   SELF_MANAGED (default, and the only tier permitted for 13+):
 *     the monitored user's toggles and master shield are absolute.
 *
 *   GUARDIAN_MANAGED (young children):
 *     the guardian may lock a channel on, and that lock outranks both the
 *     per-channel toggle and the master shield - otherwise the tier would be
 *     decorative. It is constrained by three things that are NOT negotiable:
 *       1. Revocation outranks the lock (checked first, below). A monitored
 *          user can always terminate the pairing unilaterally and instantly.
 *          This is the escape hatch that keeps the tier from being stalkerware.
 *       2. The activity indicator and the audit trail have no suppression
 *          path anywhere in this codebase - by omission, not by policy.
 *       3. Entering this tier requires the monitored user's explicit consent,
 *          and so does escalating an existing pairing into it.
 *
 * If a future change lets a guardian block revocation, or hide the indicator,
 * or suppress audit rows, this product has become stalkerware. Those three
 * are the line.
 */

export type PrivacyChannel = 'LOCATION' | 'CAMERA' | 'MICROPHONE';
export type PairingStatus = 'PENDING' | 'ACTIVE' | 'REVOKED';
export type PairingTier = 'SELF_MANAGED' | 'GUARDIAN_MANAGED';

export type DenialReason =
  | 'PAIRING_NOT_ACTIVE'
  | 'PAIRING_REVOKED'
  | 'MASTER_SHIELD_ACTIVE'
  | 'CHANNEL_DISABLED';

export interface PrivacySnapshot {
  pairingStatus: PairingStatus;
  tier: PairingTier;
  /** The monitored user's master kill switch. */
  masterShieldActive: boolean;
  locationEnabled: boolean;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  /** Only honoured when tier === 'GUARDIAN_MANAGED'. */
  guardianLockedChannels: readonly PrivacyChannel[];
}

export interface PrivacyAllowed {
  allowed: true;
  channel: PrivacyChannel;
  /** True when access is due to a guardian lock rather than the user's own setting. */
  forcedByGuardianLock: boolean;
}

export interface PrivacyDenied {
  allowed: false;
  channel: PrivacyChannel;
  reason: DenialReason;
  /** Safe to show the guardian. Deliberately does not leak which toggle. */
  message: string;
}

export type PrivacyDecision = PrivacyAllowed | PrivacyDenied;

const DENIAL_MESSAGES: Record<DenialReason, string> = {
  PAIRING_NOT_ACTIVE: 'This connection is not active.',
  PAIRING_REVOKED: 'This connection has been ended.',
  MASTER_SHIELD_ACTIVE: 'Privacy Shield is active.',
  CHANNEL_DISABLED: 'Privacy Shield is active.',
};

function channelEnabled(snapshot: PrivacySnapshot, channel: PrivacyChannel): boolean {
  switch (channel) {
    case 'LOCATION':
      return snapshot.locationEnabled;
    case 'CAMERA':
      return snapshot.cameraEnabled;
    case 'MICROPHONE':
      return snapshot.microphoneEnabled;
  }
}

function deny(channel: PrivacyChannel, reason: DenialReason): PrivacyDenied {
  return { allowed: false, channel, reason, message: DENIAL_MESSAGES[reason] };
}

/**
 * The single decision point. Pure and total: no I/O, no clock, no randomness,
 * so it can be exhaustively tested.
 *
 * Order is load-bearing. Do not reorder without reading the tier note above.
 */
export function evaluatePrivacy(
  snapshot: PrivacySnapshot,
  channel: PrivacyChannel,
): PrivacyDecision {
  // 1. Revocation and inactivity outrank everything, including a guardian
  //    lock. This is the monitored user's unconditional escape hatch.
  if (snapshot.pairingStatus === 'REVOKED') return deny(channel, 'PAIRING_REVOKED');
  if (snapshot.pairingStatus !== 'ACTIVE') return deny(channel, 'PAIRING_NOT_ACTIVE');

  // 2. A guardian lock forces the channel on, but only on the tier that
  //    permits locks at all. On SELF_MANAGED the array is ignored entirely,
  //    so a stray row cannot silently grant access.
  if (snapshot.tier === 'GUARDIAN_MANAGED' && snapshot.guardianLockedChannels.includes(channel)) {
    return { allowed: true, channel, forcedByGuardianLock: true };
  }

  // 3. Master kill switch.
  if (snapshot.masterShieldActive) return deny(channel, 'MASTER_SHIELD_ACTIVE');

  // 4. Per-channel toggle.
  if (!channelEnabled(snapshot, channel)) return deny(channel, 'CHANNEL_DISABLED');

  return { allowed: true, channel, forcedByGuardianLock: false };
}

/**
 * Guard for writes to `guardianLockedChannels`. A lock is only meaningful, and
 * only permitted, on GUARDIAN_MANAGED pairings.
 */
export function assertLocksPermitted(
  tier: PairingTier,
  requestedLocks: readonly PrivacyChannel[],
): void {
  if (requestedLocks.length > 0 && tier !== 'GUARDIAN_MANAGED') {
    throw new Error('Channel locks are only permitted on GUARDIAN_MANAGED pairings.');
  }
}

/** Channels a monitored user can still turn off themselves, given the tier. */
export function userControllableChannels(
  snapshot: Pick<PrivacySnapshot, 'tier' | 'guardianLockedChannels'>,
): PrivacyChannel[] {
  const all: PrivacyChannel[] = ['LOCATION', 'CAMERA', 'MICROPHONE'];
  if (snapshot.tier !== 'GUARDIAN_MANAGED') return all;
  return all.filter((c) => !snapshot.guardianLockedChannels.includes(c));
}

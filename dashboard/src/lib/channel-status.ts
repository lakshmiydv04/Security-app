/**
 * Derives a channel's real status from the server snapshot. Pure, and kept
 * out of the component file so it can be tested without React.
 *
 * Mirrors server/src/domain/privacy.ts exactly, including the ordering: an
 * inactive pairing beats a guardian lock, and a lock beats the master shield.
 * If this drifts from the server, the dashboard starts telling guardians a
 * channel is available when the server will refuse it - which is the specific
 * confusion this whole layer exists to prevent.
 */

import type { PrivacyChannel, PrivacySnapshot } from './types';

export type ChannelStatus = 'ON' | 'OFF' | 'SHIELDED' | 'LOCKED' | 'INACTIVE';

export function channelStatus(
  snapshot: PrivacySnapshot | undefined,
  channel: PrivacyChannel,
): ChannelStatus {
  if (!snapshot || snapshot.pairingStatus !== 'ACTIVE') return 'INACTIVE';

  if (snapshot.tier === 'GUARDIAN_MANAGED' && snapshot.guardianLockedChannels.includes(channel)) {
    return 'LOCKED';
  }
  if (snapshot.masterShieldActive) return 'SHIELDED';

  const enabled =
    channel === 'LOCATION'
      ? snapshot.locationEnabled
      : channel === 'CAMERA'
        ? snapshot.cameraEnabled
        : snapshot.microphoneEnabled;

  return enabled ? 'ON' : 'OFF';
}

/** Whether a guardian may request a stream on this channel right now. */
export function canRequestStream(status: ChannelStatus): boolean {
  return status === 'ON' || status === 'LOCKED';
}

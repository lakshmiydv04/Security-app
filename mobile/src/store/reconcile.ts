/**
 * Privacy state reconciliation - pure, so it can be tested without a device.
 *
 * The device shows toggles optimistically for responsiveness, but the server
 * is authoritative (server/src/domain/privacy.ts). When a server snapshot
 * arrives it wins outright, including when it contradicts a pending local
 * change. A toggle that "springs back" is correct behaviour and must be
 * visible to the user, not silently re-applied.
 */

import type { PrivacyChannel, PrivacySnapshot } from '../api/types';

export interface ChannelView {
  channel: PrivacyChannel;
  enabled: boolean;
  /** Locked on by the guardian; the user cannot switch it off. */
  lockedByGuardian: boolean;
  /** True while a local change is awaiting server confirmation. */
  pending: boolean;
  /** Whether the toggle should respond to touch at all. */
  interactive: boolean;
}

export const ALL_CHANNELS: PrivacyChannel[] = ['LOCATION', 'CAMERA', 'MICROPHONE'];

export function channelEnabled(s: PrivacySnapshot, channel: PrivacyChannel): boolean {
  switch (channel) {
    case 'LOCATION':
      return s.locationEnabled;
    case 'CAMERA':
      return s.cameraEnabled;
    case 'MICROPHONE':
      return s.microphoneEnabled;
  }
}

export function withChannel(
  s: PrivacySnapshot,
  channel: PrivacyChannel,
  enabled: boolean,
): PrivacySnapshot {
  switch (channel) {
    case 'LOCATION':
      return { ...s, locationEnabled: enabled };
    case 'CAMERA':
      return { ...s, cameraEnabled: enabled };
    case 'MICROPHONE':
      return { ...s, microphoneEnabled: enabled };
  }
}

function isLocked(s: PrivacySnapshot, channel: PrivacyChannel): boolean {
  // Locks only bite on the guardian-managed tier - mirrors the server rule.
  return s.tier === 'GUARDIAN_MANAGED' && s.guardianLockedChannels.includes(channel);
}

export function buildChannelViews(
  snapshot: PrivacySnapshot,
  pendingChannels: readonly PrivacyChannel[] = [],
): ChannelView[] {
  const connectionLive = snapshot.pairingStatus === 'ACTIVE';

  return ALL_CHANNELS.map((channel) => {
    const locked = isLocked(snapshot, channel);
    return {
      channel,
      // A locked channel reads as on regardless of the stored toggle, because
      // that is what the server will actually do.
      enabled: locked ? true : channelEnabled(snapshot, channel) && !snapshot.masterShieldActive,
      lockedByGuardian: locked,
      pending: pendingChannels.includes(channel),
      interactive: connectionLive && !locked,
    };
  });
}

/**
 * Server snapshot wins. Returns the snapshot to render plus the set of
 * pending channels that should now be cleared.
 */
export function reconcile(
  server: PrivacySnapshot,
  pendingChannels: readonly PrivacyChannel[],
): { snapshot: PrivacySnapshot; clearedPending: PrivacyChannel[] } {
  return { snapshot: server, clearedPending: [...pendingChannels] };
}

/**
 * Whether the device should currently be sending location for a connection.
 * Deliberately conservative: anything other than an unambiguous yes is no.
 */
export function channelAllowed(
  snapshot: PrivacySnapshot | null,
  channel: PrivacyChannel,
): boolean {
  if (!snapshot) return false;
  if (snapshot.pairingStatus !== 'ACTIVE') return false;
  if (isLocked(snapshot, channel)) return true;
  if (snapshot.masterShieldActive) return false;
  return channelEnabled(snapshot, channel);
}

/**
 * Whether the device should currently be sending location for a connection.
 * Deliberately conservative: anything other than an unambiguous yes is no.
 */
export function shouldShareLocation(snapshot: PrivacySnapshot | null): boolean {
  return channelAllowed(snapshot, 'LOCATION');
}

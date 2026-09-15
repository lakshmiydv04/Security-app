import { describe, expect, it } from 'vitest';
import { canRequestStream, channelStatus } from '../src/lib/channel-status';
import type { PrivacyChannel, PrivacySnapshot } from '../src/lib/types';

const ALL: PrivacyChannel[] = ['LOCATION', 'CAMERA', 'MICROPHONE'];

function snapshot(over: Partial<PrivacySnapshot> = {}): PrivacySnapshot {
  return {
    pairingStatus: 'ACTIVE',
    tier: 'SELF_MANAGED',
    masterShieldActive: false,
    locationEnabled: true,
    cameraEnabled: true,
    microphoneEnabled: true,
    guardianLockedChannels: [],
    ...over,
  };
}

describe('channelStatus mirrors the server rules', () => {
  it('is INACTIVE without a snapshot', () => {
    expect(channelStatus(undefined, 'CAMERA')).toBe('INACTIVE');
  });

  it('is INACTIVE on a pending or revoked pairing', () => {
    expect(channelStatus(snapshot({ pairingStatus: 'PENDING' }), 'CAMERA')).toBe('INACTIVE');
    expect(channelStatus(snapshot({ pairingStatus: 'REVOKED' }), 'CAMERA')).toBe('INACTIVE');
  });

  it('reports SHIELDED for every channel when the shield is up', () => {
    const s = snapshot({ masterShieldActive: true });
    for (const c of ALL) expect(channelStatus(s, c)).toBe('SHIELDED');
  });

  it('reports LOCKED over SHIELDED on a guardian-managed pairing', () => {
    const s = snapshot({
      tier: 'GUARDIAN_MANAGED',
      masterShieldActive: true,
      guardianLockedChannels: ['LOCATION'],
    });
    expect(channelStatus(s, 'LOCATION')).toBe('LOCKED');
    expect(channelStatus(s, 'CAMERA')).toBe('SHIELDED');
  });

  it('ignores locks on a self-managed pairing', () => {
    const s = snapshot({
      tier: 'SELF_MANAGED',
      cameraEnabled: false,
      guardianLockedChannels: ['CAMERA'],
    });
    expect(channelStatus(s, 'CAMERA')).toBe('OFF');
  });

  it('lets revocation beat a lock, matching the server', () => {
    const s = snapshot({
      pairingStatus: 'REVOKED',
      tier: 'GUARDIAN_MANAGED',
      guardianLockedChannels: ALL,
    });
    for (const c of ALL) expect(channelStatus(s, c)).toBe('INACTIVE');
  });

  it('follows the plain toggle otherwise', () => {
    expect(channelStatus(snapshot({ cameraEnabled: false }), 'CAMERA')).toBe('OFF');
    expect(channelStatus(snapshot({ cameraEnabled: true }), 'CAMERA')).toBe('ON');
  });
});

describe('canRequestStream', () => {
  it('allows only the states the server will actually accept', () => {
    expect(canRequestStream('ON')).toBe(true);
    expect(canRequestStream('LOCKED')).toBe(true);
    expect(canRequestStream('OFF')).toBe(false);
    expect(canRequestStream('SHIELDED')).toBe(false);
    expect(canRequestStream('INACTIVE')).toBe(false);
  });
});

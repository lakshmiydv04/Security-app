import { describe, expect, it } from 'vitest';
import { channelAllowed, shouldShareLocation } from '../src/store/reconcile';
import { streamsToStop } from '../src/realtime/streamGuard';
import type { PrivacySnapshot } from '../src/api/types';
import type { RootState } from '../src/store';

const base: PrivacySnapshot = {
  pairingId: 'p1',
  pairingStatus: 'ACTIVE',
  tier: 'SELF_MANAGED',
  masterShieldActive: false,
  locationEnabled: true,
  cameraEnabled: true,
  microphoneEnabled: true,
  guardianLockedChannels: [],
} as PrivacySnapshot;

const snap = (o: Partial<PrivacySnapshot>): PrivacySnapshot => ({ ...base, ...o });

describe('channelAllowed - mirrors the server precedence', () => {
  it('denies everything when there is no snapshot', () => {
    expect(channelAllowed(null, 'CAMERA')).toBe(false);
  });

  it('denies everything when the pairing is not ACTIVE', () => {
    for (const status of ['PENDING', 'REVOKED'] as const) {
      expect(channelAllowed(snap({ pairingStatus: status }), 'CAMERA')).toBe(false);
      expect(channelAllowed(snap({ pairingStatus: status }), 'LOCATION')).toBe(false);
    }
  });

  it('revocation outranks a guardian lock', () => {
    const s = snap({
      pairingStatus: 'REVOKED',
      tier: 'GUARDIAN_MANAGED',
      guardianLockedChannels: ['CAMERA'],
    });
    expect(channelAllowed(s, 'CAMERA')).toBe(false);
  });

  it('a guardian lock outranks the master shield, but only on GUARDIAN_MANAGED', () => {
    const managed = snap({
      tier: 'GUARDIAN_MANAGED',
      guardianLockedChannels: ['CAMERA'],
      masterShieldActive: true,
      cameraEnabled: false,
    });
    expect(channelAllowed(managed, 'CAMERA')).toBe(true);

    // Same locks, self-managed tier: the lock does not bite.
    const self = snap({
      tier: 'SELF_MANAGED',
      guardianLockedChannels: ['CAMERA'],
      masterShieldActive: true,
      cameraEnabled: true,
    });
    expect(channelAllowed(self, 'CAMERA')).toBe(false);
  });

  it('the master shield outranks a per-channel toggle', () => {
    expect(channelAllowed(snap({ masterShieldActive: true }), 'MICROPHONE')).toBe(false);
  });

  it('falls through to the per-channel toggle', () => {
    expect(channelAllowed(snap({ cameraEnabled: false }), 'CAMERA')).toBe(false);
    expect(channelAllowed(snap({ cameraEnabled: true }), 'CAMERA')).toBe(true);
    expect(channelAllowed(snap({ microphoneEnabled: false }), 'MICROPHONE')).toBe(false);
  });

  it('shouldShareLocation is the LOCATION channel', () => {
    expect(shouldShareLocation(snap({ locationEnabled: false }))).toBe(false);
    expect(shouldShareLocation(snap({ locationEnabled: true }))).toBe(true);
    expect(shouldShareLocation(snap({ masterShieldActive: true }))).toBe(false);
  });
});

const state = (snapshots: Record<string, PrivacySnapshot>, active: unknown[]): RootState =>
  ({ connection: { snapshots }, stream: { active } } as unknown as RootState);

describe('streamsToStop', () => {
  it('stops nothing while the channel is still permitted', () => {
    const s = state({ p1: snap({}) }, [{ pairingId: 'p1', kind: 'CAMERA', startedAt: 0 }]);
    expect(streamsToStop(s)).toEqual([]);
  });

  it('stops a live stream when the master shield goes up', () => {
    const s = state({ p1: snap({ masterShieldActive: true }) }, [
      { pairingId: 'p1', kind: 'CAMERA', startedAt: 0 },
    ]);
    expect(streamsToStop(s)).toHaveLength(1);
  });

  it('stops a live stream when the pairing is revoked', () => {
    const s = state({ p1: snap({ pairingStatus: 'REVOKED' }) }, [
      { pairingId: 'p1', kind: 'MICROPHONE', startedAt: 0 },
    ]);
    expect(streamsToStop(s)).toHaveLength(1);
  });

  it('stops a stream whose snapshot has vanished entirely', () => {
    const s = state({}, [{ pairingId: 'gone', kind: 'CAMERA', startedAt: 0 }]);
    expect(streamsToStop(s)).toHaveLength(1);
  });

  it('stops only the channel that was switched off', () => {
    const s = state({ p1: snap({ cameraEnabled: false }) }, [
      { pairingId: 'p1', kind: 'CAMERA', startedAt: 0 },
      { pairingId: 'p1', kind: 'MICROPHONE', startedAt: 0 },
    ]);
    const stopped = streamsToStop(s);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?.kind).toBe('CAMERA');
  });
});

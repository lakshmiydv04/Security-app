import { describe, expect, it } from 'vitest';
import {
  ALL_CHANNELS,
  buildChannelViews,
  reconcile,
  shouldShareLocation,
  withChannel,
} from '../src/store/reconcile';
import type { PrivacySnapshot } from '../src/api/types';

function snapshot(over: Partial<PrivacySnapshot> = {}): PrivacySnapshot {
  return {
    pairingStatus: 'ACTIVE',
    tier: 'SELF_MANAGED',
    masterShieldActive: false,
    locationEnabled: true,
    cameraEnabled: false,
    microphoneEnabled: false,
    guardianLockedChannels: [],
    ...over,
  };
}

describe('buildChannelViews', () => {
  it('marks every channel off while the shield is up', () => {
    const views = buildChannelViews(
      snapshot({ masterShieldActive: true, cameraEnabled: true, microphoneEnabled: true }),
    );
    expect(views.every((v) => !v.enabled)).toBe(true);
  });

  it('shows a guardian-locked channel as on and non-interactive', () => {
    const views = buildChannelViews(
      snapshot({
        tier: 'GUARDIAN_MANAGED',
        locationEnabled: false,
        masterShieldActive: true,
        guardianLockedChannels: ['LOCATION'],
      }),
    );
    const loc = views.find((v) => v.channel === 'LOCATION');
    // Must match what the server will actually do, not what the stored
    // toggle says - otherwise the UI lies about what is being shared.
    expect(loc?.enabled).toBe(true);
    expect(loc?.lockedByGuardian).toBe(true);
    expect(loc?.interactive).toBe(false);
  });

  it('ignores locks on a self-managed pairing', () => {
    const views = buildChannelViews(
      snapshot({ tier: 'SELF_MANAGED', cameraEnabled: false, guardianLockedChannels: ['CAMERA'] }),
    );
    const cam = views.find((v) => v.channel === 'CAMERA');
    expect(cam?.enabled).toBe(false);
    expect(cam?.lockedByGuardian).toBe(false);
    expect(cam?.interactive).toBe(true);
  });

  it('makes everything non-interactive once a pairing is revoked', () => {
    const views = buildChannelViews(snapshot({ pairingStatus: 'REVOKED' }));
    expect(views.every((v) => !v.interactive)).toBe(true);
  });

  it('flags pending channels', () => {
    const views = buildChannelViews(snapshot(), ['CAMERA']);
    expect(views.find((v) => v.channel === 'CAMERA')?.pending).toBe(true);
    expect(views.find((v) => v.channel === 'LOCATION')?.pending).toBe(false);
  });

  it('covers every channel exactly once', () => {
    expect(buildChannelViews(snapshot()).map((v) => v.channel)).toEqual(ALL_CHANNELS);
  });
});

describe('reconcile', () => {
  it('takes the server snapshot even when it contradicts local state', () => {
    const server = snapshot({ locationEnabled: false });
    const { snapshot: result, clearedPending } = reconcile(server, ['LOCATION']);
    expect(result.locationEnabled).toBe(false);
    expect(clearedPending).toEqual(['LOCATION']);
  });
});

describe('shouldShareLocation', () => {
  it('is false without a snapshot', () => {
    expect(shouldShareLocation(null)).toBe(false);
  });

  it('is false on a pending or revoked pairing', () => {
    expect(shouldShareLocation(snapshot({ pairingStatus: 'PENDING' }))).toBe(false);
    expect(shouldShareLocation(snapshot({ pairingStatus: 'REVOKED' }))).toBe(false);
  });

  it('is false while the shield is up', () => {
    expect(shouldShareLocation(snapshot({ masterShieldActive: true }))).toBe(false);
  });

  it('is true for a guardian-locked channel despite the shield', () => {
    expect(
      shouldShareLocation(
        snapshot({
          tier: 'GUARDIAN_MANAGED',
          masterShieldActive: true,
          locationEnabled: false,
          guardianLockedChannels: ['LOCATION'],
        }),
      ),
    ).toBe(true);
  });

  it('is false for a revoked pairing even with a lock - revocation wins', () => {
    expect(
      shouldShareLocation(
        snapshot({
          pairingStatus: 'REVOKED',
          tier: 'GUARDIAN_MANAGED',
          guardianLockedChannels: ['LOCATION'],
        }),
      ),
    ).toBe(false);
  });

  it('follows the plain toggle otherwise', () => {
    expect(shouldShareLocation(snapshot({ locationEnabled: true }))).toBe(true);
    expect(shouldShareLocation(snapshot({ locationEnabled: false }))).toBe(false);
  });
});

describe('withChannel', () => {
  it('sets only the named channel', () => {
    const next = withChannel(snapshot(), 'CAMERA', true);
    expect(next.cameraEnabled).toBe(true);
    expect(next.locationEnabled).toBe(true);
    expect(next.microphoneEnabled).toBe(false);
  });
});

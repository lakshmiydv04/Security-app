import { describe, expect, it } from 'vitest';
import {
  assertLocksPermitted,
  evaluatePrivacy,
  userControllableChannels,
  type PrivacyChannel,
  type PrivacySnapshot,
} from '../src/domain/privacy.js';

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

describe('evaluatePrivacy - the enforcement guarantee', () => {
  it('allows an enabled channel on an active, self-managed pairing', () => {
    for (const channel of ALL) {
      const decision = evaluatePrivacy(snapshot(), channel);
      expect(decision.allowed).toBe(true);
    }
  });

  it('denies every channel when the master shield is up', () => {
    const s = snapshot({ masterShieldActive: true });
    for (const channel of ALL) {
      const decision = evaluatePrivacy(s, channel);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('MASTER_SHIELD_ACTIVE');
    }
  });

  it('denies a channel whose own toggle is off, leaving others alone', () => {
    const s = snapshot({ cameraEnabled: false });
    const cam = evaluatePrivacy(s, 'CAMERA');
    expect(cam.allowed).toBe(false);
    if (!cam.allowed) expect(cam.reason).toBe('CHANNEL_DISABLED');
    expect(evaluatePrivacy(s, 'LOCATION').allowed).toBe(true);
  });

  it('denies everything on a revoked pairing', () => {
    const s = snapshot({ pairingStatus: 'REVOKED' });
    for (const channel of ALL) {
      const d = evaluatePrivacy(s, channel);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toBe('PAIRING_REVOKED');
    }
  });

  it('denies everything on a pairing still awaiting confirmation', () => {
    const s = snapshot({ pairingStatus: 'PENDING' });
    for (const channel of ALL) {
      expect(evaluatePrivacy(s, channel).allowed).toBe(false);
    }
  });

  it('IGNORES guardian locks on a self-managed pairing', () => {
    // A stray lock row must never grant access on the wrong tier.
    const s = snapshot({
      tier: 'SELF_MANAGED',
      cameraEnabled: false,
      guardianLockedChannels: ['CAMERA'],
    });
    expect(evaluatePrivacy(s, 'CAMERA').allowed).toBe(false);
  });

  it('honours a guardian lock on a guardian-managed pairing', () => {
    const s = snapshot({
      tier: 'GUARDIAN_MANAGED',
      locationEnabled: false,
      guardianLockedChannels: ['LOCATION'],
    });
    const d = evaluatePrivacy(s, 'LOCATION');
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.forcedByGuardianLock).toBe(true);
  });

  it('lets a guardian lock outrank the master shield, by design', () => {
    const s = snapshot({
      tier: 'GUARDIAN_MANAGED',
      masterShieldActive: true,
      guardianLockedChannels: ['LOCATION'],
    });
    expect(evaluatePrivacy(s, 'LOCATION').allowed).toBe(true);
    // ...but only for the locked channel.
    expect(evaluatePrivacy(s, 'CAMERA').allowed).toBe(false);
  });

  it('lets revocation outrank a guardian lock - the escape hatch', () => {
    // This is the single most important assertion in the suite. If it ever
    // fails, a guardian can hold a connection open against the monitored
    // user's will, and the product is stalkerware.
    const s = snapshot({
      pairingStatus: 'REVOKED',
      tier: 'GUARDIAN_MANAGED',
      guardianLockedChannels: ALL,
      masterShieldActive: false,
    });
    for (const channel of ALL) {
      const d = evaluatePrivacy(s, channel);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toBe('PAIRING_REVOKED');
    }
  });

  it('never leaks which specific control caused a denial', () => {
    const shield = evaluatePrivacy(snapshot({ masterShieldActive: true }), 'CAMERA');
    const toggle = evaluatePrivacy(snapshot({ cameraEnabled: false }), 'CAMERA');
    expect(shield.allowed).toBe(false);
    expect(toggle.allowed).toBe(false);
    if (!shield.allowed && !toggle.allowed) {
      expect(shield.message).toBe(toggle.message);
    }
  });

  it('is exhaustive over the whole state space without throwing', () => {
    const statuses = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
    const tiers = ['SELF_MANAGED', 'GUARDIAN_MANAGED'] as const;
    const bools = [true, false];
    let allowed = 0;
    let denied = 0;

    for (const pairingStatus of statuses)
      for (const tier of tiers)
        for (const masterShieldActive of bools)
          for (const locationEnabled of bools)
            for (const locks of [[], ['LOCATION'] as PrivacyChannel[]])
              for (const channel of ALL) {
                const d = evaluatePrivacy(
                  snapshot({
                    pairingStatus,
                    tier,
                    masterShieldActive,
                    locationEnabled,
                    cameraEnabled: locationEnabled,
                    microphoneEnabled: locationEnabled,
                    guardianLockedChannels: locks,
                  }),
                  channel,
                );
                if (d.allowed) allowed += 1;
                else denied += 1;
                // An inactive pairing must never produce an allow, whatever
                // else is set.
                if (pairingStatus !== 'ACTIVE') expect(d.allowed).toBe(false);
              }

    expect(allowed).toBeGreaterThan(0);
    expect(denied).toBeGreaterThan(0);
  });
});

describe('lock permissions', () => {
  it('rejects locks on a self-managed pairing', () => {
    expect(() => assertLocksPermitted('SELF_MANAGED', ['CAMERA'])).toThrow();
  });

  it('permits an empty lock set on any tier', () => {
    expect(() => assertLocksPermitted('SELF_MANAGED', [])).not.toThrow();
  });

  it('permits locks on a guardian-managed pairing', () => {
    expect(() => assertLocksPermitted('GUARDIAN_MANAGED', ['CAMERA'])).not.toThrow();
  });
});

describe('userControllableChannels', () => {
  it('gives the user everything on a self-managed pairing, locks notwithstanding', () => {
    expect(
      userControllableChannels({ tier: 'SELF_MANAGED', guardianLockedChannels: ['CAMERA'] }),
    ).toEqual(ALL);
  });

  it('withholds locked channels on a guardian-managed pairing', () => {
    expect(
      userControllableChannels({ tier: 'GUARDIAN_MANAGED', guardianLockedChannels: ['CAMERA'] }),
    ).toEqual(['LOCATION', 'MICROPHONE']);
  });
});

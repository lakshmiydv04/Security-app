import { describe, expect, it } from 'vitest';
import { decideTransition, haversineMeters, type ZoneLike } from '../src/domain/geofence.js';

const zone: ZoneLike = {
  id: 'z1',
  centerLat: 19.076,
  centerLng: 72.8777,
  radiusMeters: 200,
  notifyOnEnter: true,
  notifyOnExit: true,
};

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(19.076, 72.8777, 19.076, 72.8777)).toBeCloseTo(0, 6);
  });

  it('matches a known distance (Mumbai to Pune, ~120km)', () => {
    const d = haversineMeters(19.076, 72.8777, 18.5204, 73.8567);
    expect(d).toBeGreaterThan(115_000);
    expect(d).toBeLessThan(125_000);
  });

  it('is symmetric', () => {
    const a = haversineMeters(19.076, 72.8777, 18.5204, 73.8567);
    const b = haversineMeters(18.5204, 73.8567, 19.076, 72.8777);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('decideTransition', () => {
  it('reports ENTER on a first fix inside the zone', () => {
    expect(decideTransition(zone, 50, null)).toBe('ENTER');
  });

  it('stays silent on a first fix outside the zone', () => {
    expect(decideTransition(zone, 5_000, null)).toBeNull();
  });

  it('reports ENTER when crossing inward', () => {
    expect(decideTransition(zone, 150, false)).toBe('ENTER');
  });

  it('reports EXIT when clearly leaving', () => {
    expect(decideTransition(zone, 1_000, true)).toBe('EXIT');
  });

  it('does not flap on jitter at the boundary', () => {
    // Sitting at 220m with a 200m radius and 50m hysteresis: already inside,
    // so this must NOT count as an exit.
    expect(decideTransition(zone, 220, true)).toBeNull();
    // And from outside, 220m is not yet an entry either.
    expect(decideTransition(zone, 220, false)).toBeNull();
  });

  it('honours notifyOnEnter / notifyOnExit', () => {
    const enterOnly = { ...zone, notifyOnExit: false };
    expect(decideTransition(enterOnly, 1_000, true)).toBeNull();
    const exitOnly = { ...zone, notifyOnEnter: false };
    expect(decideTransition(exitOnly, 10, false)).toBeNull();
  });

  it('emits nothing when state is unchanged', () => {
    expect(decideTransition(zone, 10, true)).toBeNull();
    expect(decideTransition(zone, 10_000, false)).toBeNull();
  });
});

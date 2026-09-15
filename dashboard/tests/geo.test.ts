import { describe, expect, it } from 'vitest';
import {
  clampRadius,
  formatDistance,
  haversineMeters,
  isValidLatLng,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
} from '../src/lib/geo';

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(19.076, 72.8777, 19.076, 72.8777)).toBeCloseTo(0, 6);
  });

  it('matches a known distance (Mumbai to Pune, ~120km)', () => {
    const d = haversineMeters(19.076, 72.8777, 18.5204, 73.8567);
    expect(d).toBeGreaterThan(115_000);
    expect(d).toBeLessThan(125_000);
  });
});

describe('clampRadius', () => {
  it('holds the server bounds so the UI cannot submit a rejection', () => {
    expect(clampRadius(10)).toBe(MIN_RADIUS_M);
    expect(clampRadius(999_999)).toBe(MAX_RADIUS_M);
    expect(clampRadius(250)).toBe(250);
  });

  it('returns whole metres', () => {
    expect(Number.isInteger(clampRadius(250.7))).toBe(true);
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(250)).toBe('250 m');
  });

  it('switches to kilometres above one', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(25_000)).toBe('25 km');
  });
});

describe('isValidLatLng', () => {
  it('accepts real coordinates', () => {
    expect(isValidLatLng(19.076, 72.8777)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(Number.NaN, 0)).toBe(false);
  });
});

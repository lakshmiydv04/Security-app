/**
 * Geofence geometry and transition rules - pure, no I/O.
 *
 * Kept free of any Prisma import so the maths can be tested and reused
 * without a database, mirroring the audit.ts / audit-writer.ts split.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ZoneLike {
  id: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
}

export type Transition = 'ENTER' | 'EXIT' | null;

/**
 * Pure transition decision, with hysteresis.
 *
 * A GPS fix jitters, and a device sitting on a zone boundary would otherwise
 * emit an endless ENTER/EXIT storm. Entry uses the plain radius; exit requires
 * clearing the radius plus a margin, so the two thresholds never coincide.
 */
export function decideTransition(
  zone: ZoneLike,
  distanceMeters: number,
  wasInside: boolean | null,
  hysteresisMeters = 50,
): Transition {
  const isInside = wasInside
    ? distanceMeters <= zone.radiusMeters + hysteresisMeters
    : distanceMeters <= zone.radiusMeters;

  if (wasInside === null) return isInside && zone.notifyOnEnter ? 'ENTER' : null;
  if (!wasInside && isInside) return zone.notifyOnEnter ? 'ENTER' : null;
  if (wasInside && !isInside) return zone.notifyOnExit ? 'EXIT' : null;
  return null;
}

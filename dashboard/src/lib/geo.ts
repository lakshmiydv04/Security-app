/**
 * Geometry helpers for the map. Pure and testable; mirrors the server's
 * haversine so a radius drawn here means the same distance the server will
 * later compare against.
 */

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(aLat)) * Math.cos(toRad(bLat));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Server accepts 50m to 50km; clamp here so the UI cannot submit a rejection. */
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 50_000;

export function clampRadius(meters: number): number {
  return Math.round(Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, meters)));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/** Default map view when a connection has never reported a position. */
export const FALLBACK_CENTER: [number, number] = [19.076, 72.8777];

/**
 * Location access.
 *
 * Nothing here decides whether location *should* be shared - that is
 * `shouldShareLocation` in store/reconcile.ts, checked by the caller, and the
 * server checks it again. This module only knows how to ask the OS for a fix.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

export interface Fix {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  capturedAt: string;
}

export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('whenInUse');
    return status === 'granted';
  }

  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (!permission) return false;

  const granted = await PermissionsAndroid.request(permission);
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Whether location permission is currently granted, WITHOUT prompting.
 *
 * Used every tick so that a denial does not permanently silence the location
 * loop: if the person later grants it in Settings, sharing resumes without an
 * app restart.
 */
export async function hasLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  if (!permission) return false;
  return PermissionsAndroid.check(permission);
}

export function getCurrentPosition(timeoutMs = 15_000): Promise<Fix | null> {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
          capturedAt: new Date(pos.timestamp).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10_000 },
    );
  });
}

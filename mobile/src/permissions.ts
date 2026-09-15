/**
 * Runtime permission for the sensors a check-in uses.
 *
 * Asked at the moment of the request, not at install time, and only for the
 * channel actually being requested: a camera check-in must never prompt for
 * the microphone. A refusal here is a normal outcome, not an error - the
 * caller reports it and stops.
 */

import { PermissionsAndroid, Platform } from 'react-native';

export type SensorKind = 'CAMERA' | 'MICROPHONE';

export async function ensureSensorPermission(kind: SensorKind): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const permission =
    kind === 'CAMERA'
      ? PermissionsAndroid.PERMISSIONS.CAMERA
      : PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (!permission) return false;

  if (await PermissionsAndroid.check(permission)) return true;

  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

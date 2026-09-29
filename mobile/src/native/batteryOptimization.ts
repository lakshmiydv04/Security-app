/**
 * Battery-optimization exemption helper (Android).
 *
 * OEM battery managers (Samsung, Xiaomi, Oppo, Vivo, ...) kill background
 * foreground services when the phone is locked, which stops Guardian from
 * answering the dashboard. Asking the user to exempt the app is the single most
 * effective way to keep the DISCLOSED service alive while the screen is off -
 * the same thing Life360 and other trackers do.
 *
 * This deliberately opens the system SETTINGS screen rather than firing the
 * direct ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS dialog. That dialog needs
 * the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission AND is restricted by
 * Google Play - it can get a listing rejected. The settings screen needs no
 * permission and is Play-safe. See BATTERY_OPTIMIZATION.md.
 */

import { Linking, Platform } from 'react-native';

/** Whether this prompt is meaningful at all. iOS has no equivalent. */
export function batteryExemptionSupported(): boolean {
  return Platform.OS === 'android';
}

/**
 * Open the OS battery-optimization list so the user can set Guardian to
 * "Unrestricted" / "Don't optimise". Falls back to the app's own settings page
 * on ROMs that do not expose that list. Returns true if a screen was opened.
 *
 * Never throws: a settings screen failing to open must not crash the app, so
 * both intents are guarded and a false return lets the caller show guidance.
 */
export async function openBatteryOptimizationSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    // The list of every app's battery-optimization setting. No permission.
    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    return true;
  } catch {
    // Some OEM ROMs do not expose that action. The app-details page always
    // exists, and from there the user can reach Battery -> Unrestricted.
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  }
}

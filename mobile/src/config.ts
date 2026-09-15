/**
 * Runtime configuration.
 *
 * A release build reads the API URL from native build config, so it cannot
 * accidentally ship pointing at somebody's laptop.
 *
 * A debug build has no such config, so we derive the host from the Metro dev
 * server - the one address the phone is demonstrably able to reach, since it
 * just loaded its JavaScript from there. On an emulator that resolves to
 * 10.0.2.2, over adb (USB or wireless) to localhost, and over Wi-Fi to the
 * development machine's LAN address.
 *
 * Note we ask getDevServer() rather than NativeModules.SourceCode. This app
 * runs with newArchEnabled=true, i.e. bridgeless, where the legacy
 * NativeModules proxy for SourceCode does not exist - reading it returns
 * undefined and silently falls through to the emulator address, which is
 * unreachable from a real handset.
 */

import { NativeModules, Platform } from 'react-native';
import getDevServer from 'react-native/Libraries/Core/Devtools/getDevServer';

/**
 * MANUAL OVERRIDE - development escape hatch.
 *
 * Automatic resolution below follows the Metro dev server, which is right on
 * an emulator and right over Wi-Fi, but resolves to "localhost" when Metro is
 * reached through `adb reverse`. In that case the phone also needs
 * `adb reverse tcp:4000 tcp:4000`, and if that is inconvenient, put the
 * development machine's LAN address here instead, e.g.:
 *
 *   const MANUAL_API_URL: string | null = 'http://192.168.0.50:4000';
 *
 * Leave null for automatic. Never set this in anything you ship.
 */
const MANUAL_API_URL: string | null = null;

/** Port the Guardian API listens on in development. */
const DEV_API_PORT = 4000;

const LAST_RESORT = Platform.select({
  android: `http://10.0.2.2:${DEV_API_PORT}`,
  ios: `http://localhost:${DEV_API_PORT}`,
  default: `http://localhost:${DEV_API_PORT}`,
}) as string;

interface BuildConfigShape {
  GUARDIAN_API_URL?: string;
}

const buildConfig = (NativeModules.GuardianBuildConfig ?? {}) as BuildConfigShape;

/** Pull the bare host out of a URL, ignoring port and path. */
function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  return /^https?:\/\/([^/:\s]+)(?::\d+)?\//.exec(url)?.[1] ?? null;
}

function resolve(): { url: string; source: string } {
  if (MANUAL_API_URL) {
    return { url: MANUAL_API_URL, source: 'manual override' };
  }

  if (buildConfig.GUARDIAN_API_URL) {
    return { url: buildConfig.GUARDIAN_API_URL, source: 'native build config' };
  }

  if (__DEV__) {
    try {
      const dev = getDevServer();
      const host = hostOf(dev.url);
      if (host && dev.bundleLoadedFromServer) {
        return { url: `http://${host}:${DEV_API_PORT}`, source: 'metro' };
      }
    } catch {
      /* fall through to the legacy path below */
    }

    // Legacy bridge path, kept as a secondary source for non-bridgeless builds.
    const legacy = NativeModules.SourceCode as
      | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
      | undefined;
    const host = hostOf(legacy?.getConstants?.().scriptURL ?? legacy?.scriptURL);
    if (host) return { url: `http://${host}:${DEV_API_PORT}`, source: 'SourceCode' };
  }

  return { url: LAST_RESORT, source: 'fallback (no dev server found)' };
}

const resolved = resolve();

export const API_BASE_URL = resolved.url.replace(/\/+$/, '');

/** Which mechanism produced API_BASE_URL. Shown on the sign-in screen in dev. */
export const API_BASE_URL_SOURCE = resolved.source;

/** How often the device pushes a location ping while sharing is active. */
export const LOCATION_PING_INTERVAL_MS = 60_000;

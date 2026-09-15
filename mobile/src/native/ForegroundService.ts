/**
 * Bridge to the Android foreground service.
 *
 * On Android the ongoing notification is what keeps the process alive AND is
 * a second, OS-rendered disclosure that the app is running. On iOS there is
 * no equivalent API - background modes in Info.plist plus the OS-drawn
 * camera/microphone indicators do that job - so every method here is a no-op
 * on iOS by design, not by omission.
 *
 * Note what this module cannot do: it cannot suppress the OS indicators, and
 * it must never be given the ability to. Those are the real guarantee; the
 * in-app banner and this notification are additions to them.
 */

import { NativeModules, Platform } from 'react-native';

export interface ServiceState {
  /** Location is being shared with at least one guardian. */
  sharingLocation: boolean;
  /** Camera is capturing right now. */
  cameraLive: boolean;
  /** Microphone is capturing right now. */
  microphoneLive: boolean;
}

interface NativeShape {
  start(state: ServiceState): Promise<void>;
  update(state: ServiceState): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
}

const native = NativeModules.GuardianForegroundService as NativeShape | undefined;

const noop = async (): Promise<void> => {};

function unavailable(): boolean {
  if (Platform.OS !== 'android') return true;
  if (!native) {
    // A missing module on Android means the native package was not registered
    // - a build problem, not a runtime state to paper over silently.
    if (__DEV__) {
      console.warn(
        '[Guardian] GuardianForegroundService native module missing. ' +
          'Did scripts/bootstrap.mjs register GuardianServicePackage in MainApplication.kt?',
      );
    }
    return true;
  }
  return false;
}

export const ForegroundService = {
  start: (state: ServiceState): Promise<void> =>
    unavailable() ? noop() : native!.start(state),

  update: (state: ServiceState): Promise<void> =>
    unavailable() ? noop() : native!.update(state),

  stop: (): Promise<void> => (unavailable() ? noop() : native!.stop()),

  isRunning: async (): Promise<boolean> => (unavailable() ? false : native!.isRunning()),
};

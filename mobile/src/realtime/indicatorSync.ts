/**
 * Keeps the Android foreground notification in step with real stream state.
 *
 * Subscribes to the store rather than being called from components, so no
 * screen can forget to update it - and no screen can choose not to.
 */

import { ForegroundService, type ServiceState } from '../native/ForegroundService';
import { shouldShareLocation } from '../store/reconcile';
import type { RootState } from '../store';

function derive(state: RootState): ServiceState {
  const sharingLocation = Object.values(state.connection.snapshots).some((s) =>
    shouldShareLocation(s ?? null),
  );
  return {
    sharingLocation,
    cameraLive: state.stream.active.some((s) => s.kind === 'CAMERA'),
    microphoneLive: state.stream.active.some((s) => s.kind === 'MICROPHONE'),
  };
}

function same(a: ServiceState, b: ServiceState): boolean {
  return (
    a.sharingLocation === b.sharingLocation &&
    a.cameraLive === b.cameraLive &&
    a.microphoneLive === b.microphoneLive
  );
}

export function createIndicatorSync(getState: () => RootState): () => void {
  let last: ServiceState | null = null;
  let running = false;
  let queue: Promise<void> = Promise.resolve();

  return () => {
    const next = derive(getState());
    if (last && same(last, next)) return;
    last = next;

    const anythingActive = next.sharingLocation || next.cameraLive || next.microphoneLive;

    // Serialised, and `running` is only set from what actually happened.
    //
    // Previously `running = true` was set BEFORE an un-awaited start() whose
    // rejection was swallowed. On Android 12+ a background start throws
    // ForegroundServiceStartNotAllowedException - the notification never
    // appeared, every later call took the update() branch, and the app went on
    // believing the disclosure was up. For a transparency guarantee, failing
    // silently is the worst possible behaviour.
    queue = queue
      .then(async () => {
        if (!anythingActive) {
          if (running) {
            await ForegroundService.stop();
            running = false;
          }
          return;
        }
        if (!running) {
          await ForegroundService.start(next);
          running = true;
        } else {
          await ForegroundService.update(next);
        }
      })
      .catch((err: unknown) => {
        // Do not latch. Clear the memo so the next state change retries.
        running = false;
        last = null;
        if (__DEV__) {
          console.warn('[Guardian] foreground service call failed', err);
        }
      });
  };
}

export { derive as deriveServiceState };

/**
 * Ends any live stream the current privacy state no longer permits.
 *
 * Subscribes to the store rather than living in a screen, for the same reason
 * indicatorSync does: no screen can forget to run it, and no screen can choose
 * not to.
 *
 * Without this, the only way a stream ended was a fixed timer. Raising the
 * master shield or revoking a pairing left capture running until that timer
 * happened to fire - the camera still on after the person had said stop, which
 * is precisely the failure this product exists to prevent.
 */

import { channelAllowed } from '../store/reconcile';
import type { ActiveStream } from '../store/streamSlice';
import type { RootState } from '../store';

/** Active streams whose channel is no longer permitted. Pure, so it is tested. */
export function streamsToStop(state: RootState): ActiveStream[] {
  return state.stream.active.filter(
    (s) => !channelAllowed(state.connection.snapshots[s.pairingId] ?? null, s.kind),
  );
}

export function createStreamGuard(
  getState: () => RootState,
  stop: (stream: ActiveStream) => void,
): () => void {
  return () => {
    for (const stream of streamsToStop(getState())) stop(stream);
  };
}

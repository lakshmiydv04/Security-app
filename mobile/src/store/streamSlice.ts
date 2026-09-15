/**
 * Live-stream state - what the indicator renders from.
 *
 * There is deliberately no action that hides the indicator while a stream is
 * live. `streamStopped` is the only way an entry leaves this slice, and it is
 * dispatched when capture actually ends. If a future change adds a "dismiss"
 * or "minimise" action here, the transparency guarantee is gone.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type StreamKind = 'CAMERA' | 'MICROPHONE';

export interface ActiveStream {
  pairingId: string;
  kind: StreamKind;
  startedAt: number;
}

export interface StreamState {
  active: ActiveStream[];
}

const initialState: StreamState = { active: [] };

const key = (s: { pairingId: string; kind: StreamKind }) => `${s.pairingId}:${s.kind}`;

const streamSlice = createSlice({
  name: 'stream',
  initialState,
  reducers: {
    streamStarted(state, action: PayloadAction<{ pairingId: string; kind: StreamKind }>) {
      if (state.active.some((s) => key(s) === key(action.payload))) return;
      state.active.push({ ...action.payload, startedAt: Date.now() });
    },
    streamStopped(state, action: PayloadAction<{ pairingId: string; kind: StreamKind }>) {
      state.active = state.active.filter((s) => key(s) !== key(action.payload));
    },
    allStreamsStopped(state) {
      state.active = [];
    },
  },
});

export const { streamStarted, streamStopped, allStreamsStopped } = streamSlice.actions;
export const streamReducer = streamSlice.reducer;

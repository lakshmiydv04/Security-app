import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PairingSummary, PrivacyChannel, PrivacySnapshot } from '../api/types';

export interface ConnectionState {
  pairings: PairingSummary[];
  activePairingId: string | null;
  /** Authoritative snapshot as last reported by the server, per pairing. */
  snapshots: Record<string, PrivacySnapshot | undefined>;
  /** Channels with a local change in flight, per pairing. */
  pending: Record<string, PrivacyChannel[] | undefined>;
  loading: boolean;
  error: string | null;
  /** Set when the server rejected a toggle, e.g. a guardian-locked channel. */
  refusal: string | null;
}

const initialState: ConnectionState = {
  pairings: [],
  activePairingId: null,
  snapshots: {},
  pending: {},
  loading: false,
  error: null,
  refusal: null,
};

const connectionSlice = createSlice({
  name: 'connection',
  initialState,
  reducers: {
    pairingsLoaded(state, action: PayloadAction<PairingSummary[]>) {
      state.pairings = action.payload;
      state.loading = false;
      state.error = null;
      const active = action.payload.find((p) => p.status === 'ACTIVE');
      state.activePairingId ??= active?.id ?? action.payload[0]?.id ?? null;
    },
    activePairingChanged(state, action: PayloadAction<string>) {
      state.activePairingId = action.payload;
    },
    /**
     * The server's word on privacy state. Overwrites whatever the UI was
     * showing and clears any pending marker for that pairing - a toggle
     * springing back is intentional feedback, not a glitch to paper over.
     */
    snapshotReceived(
      state,
      action: PayloadAction<{ pairingId: string; snapshot: PrivacySnapshot }>,
    ) {
      state.snapshots[action.payload.pairingId] = action.payload.snapshot;
      state.pending[action.payload.pairingId] = [];
    },
    channelPending(
      state,
      action: PayloadAction<{ pairingId: string; channel: PrivacyChannel }>,
    ) {
      const list = state.pending[action.payload.pairingId] ?? [];
      if (!list.includes(action.payload.channel)) list.push(action.payload.channel);
      state.pending[action.payload.pairingId] = list;
      state.refusal = null;
    },
    channelSettled(
      state,
      action: PayloadAction<{ pairingId: string; channel: PrivacyChannel }>,
    ) {
      state.pending[action.payload.pairingId] = (
        state.pending[action.payload.pairingId] ?? []
      ).filter((c) => c !== action.payload.channel);
    },
    /** Master shield is a user-level flag; mirror it into every snapshot. */
    masterShieldChanged(state, action: PayloadAction<boolean>) {
      for (const id of Object.keys(state.snapshots)) {
        const snap = state.snapshots[id];
        if (snap) snap.masterShieldActive = action.payload;
      }
    },
    connectionsLoading(state) {
      state.loading = true;
      state.error = null;
    },
    connectionsFailed(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    refused(state, action: PayloadAction<string | null>) {
      state.refusal = action.payload;
    },
  },
});

export const {
  pairingsLoaded,
  activePairingChanged,
  snapshotReceived,
  channelPending,
  channelSettled,
  masterShieldChanged,
  connectionsLoading,
  connectionsFailed,
  refused,
} = connectionSlice.actions;
export const connectionReducer = connectionSlice.reducer;

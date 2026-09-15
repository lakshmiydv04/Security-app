import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TokenPair } from '../api/client';
import type { AuthUser } from '../api/types';

export interface AuthState {
  user: AuthUser | null;
  tokens: TokenPair | null;
  status: 'restoring' | 'signedOut' | 'signedIn';
  error: string | null;
  busy: boolean;
}

const initialState: AuthState = {
  user: null,
  tokens: null,
  status: 'restoring',
  error: null,
  busy: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    restored(state, action: PayloadAction<{ tokens: TokenPair | null }>) {
      state.tokens = action.payload.tokens;
      state.status = action.payload.tokens ? 'signedIn' : 'signedOut';
    },
    signedIn(state, action: PayloadAction<{ user: AuthUser; tokens: TokenPair }>) {
      state.user = action.payload.user;
      state.tokens = action.payload.tokens;
      state.status = 'signedIn';
      state.error = null;
      state.busy = false;
    },
    signedOut(state) {
      state.user = null;
      state.tokens = null;
      state.status = 'signedOut';
      state.busy = false;
    },
    tokensRotated(state, action: PayloadAction<TokenPair | null>) {
      state.tokens = action.payload;
      if (!action.payload) {
        state.status = 'signedOut';
        state.user = null;
      }
    },
    authBusy(state, action: PayloadAction<boolean>) {
      state.busy = action.payload;
      if (action.payload) state.error = null;
    },
    authFailed(state, action: PayloadAction<string>) {
      state.error = action.payload;
      state.busy = false;
    },
  },
});

export const { restored, signedIn, signedOut, tokensRotated, authBusy, authFailed } =
  authSlice.actions;
export const authReducer = authSlice.reducer;

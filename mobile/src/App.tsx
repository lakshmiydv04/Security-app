/**
 * App root and orchestration.
 *
 * Deliberately holds the wiring that must never be a screen's responsibility:
 * the indicator sync, the socket subscription and the location loop all live
 * here so that no screen can neglect them, and the indicator banner is
 * rendered above everything so no screen can cover it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { store, useAppDispatch, useAppSelector } from './store';
import { configureApi } from './api/client';
import { locationApi, pairingApi, privacyApi } from './api/endpoints';
import { loadTokens, saveTokens } from './store/secureTokens';
import { restored, tokensRotated } from './store/authSlice';
import {
  connectionsFailed,
  connectionsLoading,
  pairingsLoaded,
  snapshotReceived,
} from './store/connectionSlice';
import { streamStarted, streamStopped } from './store/streamSlice';
import { shouldShareLocation } from './store/reconcile';
import {
  connectSocket,
  disconnectSocket,
  reportIndicator,
  subscribeToPairing,
} from './realtime/socket';
import { createIndicatorSync } from './realtime/indicatorSync';
import { createStreamGuard } from './realtime/streamGuard';
import { startMediaSession, type MediaSession } from './realtime/mediaSession';
import { ensureSensorPermission } from './permissions';
import { ensureLocationPermission, getCurrentPosition, hasLocationPermission } from './location';
import { LOCATION_PING_INTERVAL_MS } from './config';

/** Hard ceiling on a single check-in, so nothing can run indefinitely. */
const MAX_SESSION_MS = 5 * 60_000;
import { SignInScreen } from './screens/SignInScreen';
import { PairingScreen } from './screens/PairingScreen';
import { PrivacyControlScreen } from './screens/PrivacyControlScreen';
import { StreamIndicatorBanner } from './components/StreamIndicatorBanner';
import { theme } from './theme';

function Root(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const authStatus = useAppSelector((s) => s.auth.status);
  const accessToken = useAppSelector((s) => s.auth.tokens?.accessToken);
  const pairings = useAppSelector((s) => s.connection.pairings);
  const [showPairing, setShowPairing] = useState(false);

  // The API client reads tokens through these, so a rotation performed inside
  // a request is reflected in the store and persisted without the caller
  // knowing anything happened.
  useEffect(() => {
    configureApi(
      () => store.getState().auth.tokens,
      async (tokens) => {
        await saveTokens(tokens);
        store.dispatch(tokensRotated(tokens));
      },
    );
  }, []);

  useEffect(() => {
    void (async () => {
      const tokens = await loadTokens();
      dispatch(restored({ tokens }));
    })();
  }, [dispatch]);

  // One timer per live stream. Previously a single shared timeout meant a
  // second command for the same channel could let the FIRST timer take the
  // banner and notification down while the second stream was still running -
  // indicator off, capture on.
  const streamTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mediaSessions = useRef(new Map<string, MediaSession>());

  const endStream = useCallback(
    async (pairingId: string, kind: 'CAMERA' | 'MICROPHONE') => {
      const key = `${pairingId}:${kind}`;
      const timer = streamTimers.current.get(key);
      if (timer) {
        clearTimeout(timer);
        streamTimers.current.delete(key);
      }

      // Releasing the camera is what clears the OS indicator, so it happens
      // before anything that could fail on the network.
      const session = mediaSessions.current.get(key);
      if (session) {
        mediaSessions.current.delete(key);
        await session.stop('ENDED');
      }

      dispatch(streamStopped({ pairingId, kind }));
      reportIndicator(pairingId, kind, false);
    },
    [dispatch],
  );

  // Clear timers on unmount so nothing fires against a torn-down store.
  useEffect(
    () => () => {
      for (const timer of streamTimers.current.values()) clearTimeout(timer);
      streamTimers.current.clear();
      for (const session of mediaSessions.current.values()) void session.stop('APP_CLOSED');
      mediaSessions.current.clear();
    },
    [],
  );

  // Stop any stream the privacy state no longer permits. Raising the shield or
  // revoking must end capture immediately, not whenever a timer expires.
  useEffect(() => {
    const guard = createStreamGuard(
      () => store.getState(),
      (stream) => void endStream(stream.pairingId, stream.kind),
    );
    guard();
    return store.subscribe(guard);
  }, [endStream]);

  const refreshConnections = useCallback(async () => {
    dispatch(connectionsLoading());
    try {
      const { pairings: list } = await pairingApi.list();
      dispatch(pairingsLoaded(list));

      await Promise.all(
        list.map(async (p) => {
          try {
            const snapshot = await privacyApi.get(p.id);
            dispatch(snapshotReceived({ pairingId: p.id, snapshot }));
            await subscribeToPairing(p.id);
          } catch {
            /* one unreadable connection must not blank the whole screen */
          }
        }),
      );
    } catch {
      dispatch(connectionsFailed('Could not load your connections.'));
    }
  }, [dispatch]);

  // Keep the Android foreground notification in step with real stream state.
  useEffect(() => {
    const sync = createIndicatorSync(() => store.getState());
    sync();
    return store.subscribe(sync);
  }, []);

  // Socket lifecycle.
  useEffect(() => {
    if (authStatus !== 'signedIn' || !accessToken) {
      disconnectSocket();
      return;
    }

    connectSocket(accessToken, {
      onConnectionChange: (connected) => {
        if (connected) void refreshConnections();
      },
      onPrivacyState: (pairingId, snapshot) => {
        dispatch(snapshotReceived({ pairingId, snapshot }));
      },
      getSnapshot: (pairingId) => store.getState().connection.snapshots[pairingId] ?? null,
      onSensorCommand: (command) => {
        // Indicator first, capture second. If capture is ever wired in below,
        // it must stay in this order - a stream that starts before the banner
        // is up is exactly the failure this product exists to prevent.
        dispatch(streamStarted({ pairingId: command.pairingId, kind: command.kind }));
        reportIndicator(command.pairingId, command.kind, true);

        const key = `${command.pairingId}:${command.kind}`;
        const existing = streamTimers.current.get(key);
        if (existing) clearTimeout(existing);
        // A ceiling, not the normal exit. Sessions end on hang-up or on a
        // privacy change; this only catches one that outlives both.
        streamTimers.current.set(
          key,
          setTimeout(() => void endStream(command.pairingId, command.kind), MAX_SESSION_MS),
        );

        void (async () => {
          try {
            // Ask only for the channel that was consented to. A camera
            // check-in must never prompt for the microphone.
            if (!(await ensureSensorPermission(command.kind))) {
              await endStream(command.pairingId, command.kind);
              return;
            }
            const session = await startMediaSession({
              pairingId: command.pairingId,
              kind: command.kind,
              onEnded: () => {
                mediaSessions.current.delete(key);
                void endStream(command.pairingId, command.kind);
              },
            });
            mediaSessions.current.set(key, session);
          } catch (err) {
            if (__DEV__) {
              console.warn('[Guardian] could not start the media session', err);
            }
            await endStream(command.pairingId, command.kind);
          }
        })();
      },
      onLocalRefusal: (command) => {
        void endStream(command.pairingId, command.kind);
      },
    });

    void refreshConnections();
    return () => disconnectSocket();
  }, [authStatus, accessToken, dispatch, refreshConnections, endStream]);

  // Location loop. Gated per pairing by the same rule the server enforces.
  const permissionAsked = useRef(false);
  useEffect(() => {
    if (authStatus !== 'signedIn') return;

    let cancelled = false;

    const tick = async (): Promise<void> => {
      const state = store.getState();
      const sharing = state.connection.pairings.filter((p) =>
        shouldShareLocation(state.connection.snapshots[p.id] ?? null),
      );
      if (sharing.length === 0) return;

      // Prompt once per app run, but re-check the grant every tick WITHOUT
      // prompting. Previously a single denial set permissionAsked forever, so
      // the loop silently produced nothing while the toggle still read ON and
      // the notification still claimed location was being shared.
      if (!permissionAsked.current) {
        permissionAsked.current = true;
        await ensureLocationPermission();
      }
      if (!(await hasLocationPermission())) return;

      const fix = await getCurrentPosition();
      if (!fix || cancelled) return;

      // Re-check after the await. A fix can take up to 15 seconds and the
      // shield may have gone up in that window; pushing the list computed at
      // tick start would send a point captured AFTER the person said stop.
      const current = store.getState().connection;
      const stillSharing = current.pairings.filter((p) =>
        shouldShareLocation(current.snapshots[p.id] ?? null),
      );
      if (stillSharing.length === 0) return;

      await Promise.all(
        stillSharing.map((p) =>
          locationApi.push(p.id, fix).catch(() => {
            // A refusal here means the server's view is stricter than ours;
            // the next privacy:state event will correct the UI.
          }),
        ),
      );
    };

    void tick();
    const id = setInterval(() => void tick(), LOCATION_PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [authStatus]);

  const content = (): React.JSX.Element => {
    if (authStatus === 'restoring') return <View style={styles.flex} />;
    if (authStatus === 'signedOut') return <SignInScreen />;
    if (showPairing || pairings.length === 0) {
      return (
        <PairingScreen
          onPaired={() => {
            setShowPairing(false);
            void refreshConnections();
          }}
        />
      );
    }
    return (
      <PrivacyControlScreen
        onRefresh={refreshConnections}
        onAddConnection={() => setShowPairing(true)}
      />
    );
  };

  return (
    <View style={styles.flex}>
      <StatusBar barStyle="light-content" backgroundColor={theme.color.bg} />
      {/* Above the screen stack: no route can cover it. */}
      <StreamIndicatorBanner />
      {content()}
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.bg },
});

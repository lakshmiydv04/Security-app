'use client';

/**
 * Holds the guardian's connections and their authoritative privacy state,
 * kept current by the socket.
 *
 * The snapshot in here is the server's, never the UI's optimism. Components
 * derive button state from it so that a channel the monitored person has just
 * switched off cannot be actioned from a stale render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { pairingApi, privacyApi } from '@/lib/endpoints';
import { connectSocket, disconnectSocket, subscribeToPairing, type SosAlert } from '@/lib/socket';
import type { PairingSummary, PrivacySnapshot } from '@/lib/types';

export interface LiveState {
  pairings: PairingSummary[];
  snapshots: Record<string, PrivacySnapshot | undefined>;
  liveIndicators: Record<string, string[] | undefined>;
  /** Unacknowledged SOS alerts, newest first. */
  sosAlerts: SosAlert[];
  dismissSos: (alertId: string | null, pairingId: string) => void;
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLiveConnections(accessToken: string | null): LiveState {
  const [pairings, setPairings] = useState<PairingSummary[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, PrivacySnapshot | undefined>>({});
  const [liveIndicators, setLiveIndicators] = useState<Record<string, string[] | undefined>>({});
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { pairings: list } = await pairingApi.list();
      if (!mounted.current) return;
      setPairings(list);
      setError(null);

      // Prune snapshots for connections that no longer exist. This map only
      // ever merged, so a removed or revoked pairing kept its last-known
      // snapshot forever.
      const liveIds = new Set(list.map((p) => p.id));
      if (mounted.current) {
        setSnapshots((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([id]) => liveIds.has(id))),
        );
      }

      await Promise.all(
        list.map(async (p) => {
          try {
            const snapshot = await privacyApi.get(p.id);
            if (!mounted.current) return;
            // The pairing list is the fresher source of truth for status, so
            // it wins over whatever the snapshot carries. Without this a
            // revoked connection could still render as ACTIVE.
            setSnapshots((prev) => ({
              ...prev,
              [p.id]: { ...snapshot, pairingStatus: p.status },
            }));
            await subscribeToPairing(p.id);
          } catch {
            // A snapshot we could not read must NOT leave the previous one in
            // place. Keeping a stale ACTIVE snapshot is how the panel came to
            // show "Available" and an enabled Request button on a pairing the
            // server would refuse - the exact UI-lies-about-the-server case
            // channel-status.ts exists to prevent. Dropping it renders
            // INACTIVE instead, which errs in the safe direction.
            if (mounted.current) {
              setSnapshots((prev) => {
                if (!(p.id in prev)) return prev;
                const next = { ...prev };
                delete next[p.id];
                return next;
              });
            }
          }
        }),
      );
    } catch {
      if (mounted.current) setError('Could not load your connections.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      disconnectSocket();
      return;
    }

    connectSocket(accessToken, {
      onConnectionChange: (isConnected) => {
        if (!mounted.current) return;
        setConnected(isConnected);
        if (isConnected) void refresh();
      },
      onPrivacyState: (pairingId, snapshot) => {
        if (mounted.current) setSnapshots((prev) => ({ ...prev, [pairingId]: snapshot }));
      },
      onSosAlert: (alert) => {
        if (!mounted.current) return;
        setSosAlerts((prev) => {
          // The same alert arrives on two rooms; dedupe on id, falling back to
          // pairing + timestamp when the id is absent.
          const key = (a: SosAlert) => a.alertId ?? `${a.pairingId}:${a.triggeredAt}`;
          if (prev.some((a) => key(a) === key(alert))) return prev;
          return [alert, ...prev];
        });
      },
      onIndicator: (pairingId, kind, active) => {
        if (!mounted.current) return;
        setLiveIndicators((prev) => {
          const current = prev[pairingId] ?? [];
          const next = active
            ? [...new Set([...current, kind])]
            : current.filter((k) => k !== kind);
          return { ...prev, [pairingId]: next };
        });
      },
    });

    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
      disconnectSocket();
    };
  }, [accessToken, refresh]);

  const dismissSos = useCallback((alertId: string | null, pairingId: string) => {
    setSosAlerts((prev) =>
      prev.filter((a) => (alertId ? a.alertId !== alertId : a.pairingId !== pairingId)),
    );
  }, []);

  return {
    pairings,
    snapshots,
    liveIndicators,
    sosAlerts,
    dismissSos,
    connected,
    loading,
    error,
    refresh,
  };
}

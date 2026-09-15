'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { SensorPanel } from '@/components/SensorPanel';
import { GeofencePanel } from '@/components/GeofencePanel';
import { AuditTable } from '@/components/AuditTable';
import { AlertFeed } from '@/components/AlertFeed';
import { SosAlertBanner } from '@/components/SosAlertBanner';
import { LiveStreamPanel } from '@/components/LiveStreamPanel';
import { useLiveStream } from '@/hooks/useLiveStream';
import { useAuth } from '@/lib/auth-context';
import { useLiveConnections } from '@/hooks/useLiveConnections';
import { auditApi, geofenceApi, locationApi, pairingApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { formatDistance } from '@/lib/geo';
import type {
  AuditEvent,
  ChainVerification,
  GeofenceEvent,
  GeofenceZone,
  LatestLocationResponse,
} from '@/lib/types';

// Leaflet touches `window` at module scope, so it must never be server
// rendered. The placeholder keeps layout stable while it loads.
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[420px] w-full place-items-center rounded-xl border border-line bg-ink-raised text-muted">
      Loading map…
    </div>
  ),
});

interface DraftZone {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

export default function ConnectionDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const pairingId = params?.id ?? '';
  const { accessToken } = useAuth();
  const { pairings, snapshots, liveIndicators, sosAlerts, dismissSos, connected, refresh } =
    useLiveConnections(accessToken);

  const [location, setLocation] = useState<LatestLocationResponse | null>(null);

  // Live camera / microphone. The device offers; this answers.
  const {
    live,
    status: liveStatus,
    lastEndReason,
    stop: stopLive,
  } = useLiveStream(pairingId);
  const [zones, setZones] = useState<GeofenceZone[]>([]);
  const [zoneEvents, setZoneEvents] = useState<GeofenceEvent[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<DraftZone | null>(null);

  const pairing = pairings.find((p) => p.id === pairingId);
  const snapshot = snapshots[pairingId];
  const liveKinds = useMemo(() => liveIndicators[pairingId] ?? [], [liveIndicators, pairingId]);

  const pairingSos = useMemo(
    () => sosAlerts.filter((a) => a.pairingId === pairingId),
    [sosAlerts, pairingId],
  );
  const sosPoint = useMemo(() => {
    const withFix = pairingSos.find((a) => a.lat != null && a.lng != null);
    return withFix ? { lat: withFix.lat!, lng: withFix.lng!, triggeredAt: withFix.triggeredAt } : null;
  }, [pairingSos]);

  const loadDetail = useCallback(async () => {
    if (!pairingId || !accessToken) return;
    try {
      const [loc, zoneList, events] = await Promise.all([
        locationApi.latest(pairingId),
        geofenceApi.list(pairingId),
        geofenceApi.events(pairingId),
      ]);
      setLocation(loc);
      setZones(zoneList.zones);
      setZoneEvents(events.events);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this connection.');
    }
  }, [pairingId, accessToken]);

  const loadAudit = useCallback(async () => {
    if (!pairingId || !accessToken) return;
    setAuditLoading(true);
    try {
      const [{ events }, chain] = await Promise.all([
        auditApi.list(pairingId),
        auditApi.verify().catch(() => null),
      ]);
      setAudit(events);
      setVerification(chain);
    } catch {
      // The log failing to load must not take the rest of the page with it.
    } finally {
      setAuditLoading(false);
    }
  }, [pairingId, accessToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([loadDetail(), loadAudit()]);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDetail, loadAudit]);

  // Poll position while sharing is live. The socket carries privacy state,
  // not the location stream, so this is the position path.
  useEffect(() => {
    if (!location?.sharingActive) return;
    const id = setInterval(() => void loadDetail(), 30_000);
    return () => clearInterval(id);
  }, [location?.sharingActive, loadDetail]);

  const endConnection = useCallback(async () => {
    if (!window.confirm('End this connection? Sharing stops immediately for both of you.')) return;
    try {
      await pairingApi.revoke(pairingId, 'Ended by guardian');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    }
  }, [pairingId, refresh]);

  const afterZoneChange = useCallback(async () => {
    setDraft(null);
    setPlacing(false);
    await loadDetail();
    await loadAudit();
  }, [loadDetail, loadAudit]);

  return (
    <AppShell connected={connected}>
      <SosAlertBanner
        alerts={pairingSos}
        nameFor={() => pairing?.monitoredUser.displayName ?? 'this connection'}
        onDismiss={(alertId, pid) => {
          dismissSos(alertId, pid);
          void loadAudit();
        }}
      />

      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/connections" className="text-accent hover:underline">
          ← All connections
        </Link>
      </nav>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {pairing?.monitoredUser.displayName ?? 'Connection'}
        </h1>
        {pairing?.status === 'ACTIVE' && (
          <button
            onClick={() => void endConnection()}
            className="rounded-lg border border-live/50 px-3 py-1.5 text-sm text-live"
          >
            End connection
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-live">
          {error}
        </p>
      )}

      {pairing?.status === 'REVOKED' && (
        <p className="mt-4 rounded-lg border border-line bg-ink-raised px-4 py-3 text-sm text-muted">
          This connection has ended. Nothing is being shared.
        </p>
      )}

      <div className="mt-6 space-y-6">
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Location</h2>
            <span className="text-sm text-muted">
              {location?.sharingActive
                ? location.latest
                  ? `Updated ${formatRelative(location.latest.capturedAt)}`
                  : 'Sharing on, waiting for a first position'
                : (location?.reason ?? 'Location sharing is off')}
            </span>
          </div>

          {/* Exact position, in text. The map alone puts the single most
              important fact on this page behind a visual, which is both a
              WCAG 1.1.1 failure and simply harder to read off. */}
          {location?.latest ? (
            <dl className="mb-3 grid gap-x-6 gap-y-2 rounded-lg border border-line bg-ink p-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Coordinates</dt>
                <dd className="font-mono text-sm">
                  {location.latest.lat.toFixed(6)}, {location.latest.lng.toFixed(6)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Accuracy</dt>
                <dd className="text-sm">
                  {location.latest.accuracyMeters != null
                    ? `within ${formatDistance(location.latest.accuracyMeters)}`
                    : 'not reported'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Recorded at</dt>
                <dd className="text-sm">
                  {new Date(location.latest.capturedAt).toLocaleString()}
                </dd>
              </div>
            </dl>
          ) : null}

          <p className="sr-only" aria-live="polite">
            {location?.latest
              ? `Location updated ${formatRelative(location.latest.capturedAt)}. ` +
                `Latitude ${location.latest.lat.toFixed(5)}, ` +
                `longitude ${location.latest.lng.toFixed(5)}` +
                (location.latest.accuracyMeters != null
                  ? `, accurate to about ${formatDistance(location.latest.accuracyMeters)}.`
                  : '.')
              : location?.sharingActive
                ? 'Location sharing is on. No position has been received yet.'
                : (location?.reason ?? 'Location sharing is off.')}
          </p>
          <MapView
            position={location?.latest ?? null}
            sharingActive={location?.sharingActive ?? false}
            zones={zones}
            draft={draft}
            placing={placing}
            onPlace={(lat, lng) =>
              setDraft({ centerLat: lat, centerLng: lng, radiusMeters: 250 })
            }
            sos={sosPoint}
          />
        </section>

        <LiveStreamPanel
          live={live}
          status={liveStatus}
          lastEndReason={lastEndReason}
          onStop={stopLive}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <SensorPanel
            pairingId={pairingId}
            snapshot={snapshot}
            liveKinds={liveKinds}
            onChanged={() => {
              void refresh();
              void loadAudit();
            }}
          />

          <GeofencePanel
            pairingId={pairingId}
            zones={zones}
            draft={draft}
            placing={placing}
            onStartPlacing={() => setPlacing(true)}
            onCancel={() => {
              setDraft(null);
              setPlacing(false);
            }}
            onDraftChange={setDraft}
            onSaved={() => void afterZoneChange()}
          />
        </div>

        <AlertFeed events={zoneEvents} />
        <AuditTable events={audit} verification={verification} loading={auditLoading} />
      </div>
    </AppShell>
  );
}

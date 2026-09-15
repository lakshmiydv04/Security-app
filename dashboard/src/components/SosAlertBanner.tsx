'use client';

/**
 * Live SOS alert.
 *
 * Pinned above everything and impossible to miss: this is the one event in
 * the product where a guardian being slow to notice has real consequences.
 * Dismissing is explicit and per-alert - there is no auto-hide timer, because
 * an alert that vanishes while someone is out of the room has failed.
 */

import { useCallback, useState } from 'react';
import { sosApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { formatRelative, formatTime } from '@/lib/format';
import type { SosAlert } from '@/lib/socket';

interface Props {
  alerts: SosAlert[];
  nameFor: (pairingId: string) => string;
  onDismiss: (alertId: string | null, pairingId: string) => void;
  onLocate?: (alert: SosAlert) => void;
}

export function SosAlertBanner({
  alerts,
  nameFor,
  onDismiss,
  onLocate,
}: Props): React.JSX.Element | null {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const acknowledge = useCallback(
    async (alert: SosAlert) => {
      if (!alert.alertId) {
        onDismiss(alert.alertId, alert.pairingId);
        return;
      }
      setBusy(alert.alertId);
      setError(null);
      try {
        await sosApi.acknowledge(alert.alertId);
        onDismiss(alert.alertId, alert.pairingId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      } finally {
        setBusy(null);
      }
    },
    [onDismiss],
  );

  if (alerts.length === 0) return null;

  return (
    <div
      className="sticky top-14 z-30 space-y-2"
      role="alert"
      aria-live="assertive"
      aria-atomic="false"
    >
      {alerts.map((alert) => {
        const key = alert.alertId ?? `${alert.pairingId}:${alert.triggeredAt}`;
        const hasFix = alert.lat != null && alert.lng != null;

        return (
          <div
            key={key}
            className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-live bg-live/15 px-4 py-3"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-pulse rounded-full bg-live"
            />

            <div className="min-w-[220px] flex-1">
              <p className="font-bold text-live">
                SOS from {nameFor(alert.pairingId)}
              </p>
              <p className="text-sm text-muted">
                <time dateTime={alert.triggeredAt} title={formatTime(alert.triggeredAt)}>
                  {formatRelative(alert.triggeredAt)}
                </time>
                {hasFix ? (
                  <>
                    {' · '}
                    {alert.lat!.toFixed(5)}, {alert.lng!.toFixed(5)}
                    {alert.accuracyMeters != null && ` (±${Math.round(alert.accuracyMeters)} m)`}
                  </>
                ) : (
                  ' · no location was available'
                )}
              </p>
            </div>

            {hasFix && onLocate && (
              <button
                onClick={() => onLocate(alert)}
                className="rounded-lg border border-live px-3 py-1.5 text-sm font-semibold text-live"
              >
                Show on map
              </button>
            )}

            <button
              onClick={() => void acknowledge(alert)}
              disabled={busy === alert.alertId}
              className="rounded-lg bg-live px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === alert.alertId ? 'Sending…' : 'Acknowledge'}
            </button>
          </div>
        );
      })}

      {error && <p className="px-4 text-sm text-live">{error}</p>}
    </div>
  );
}

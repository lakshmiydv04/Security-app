'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { PairingGenerator } from '@/components/PairingGenerator';
import { SosAlertBanner } from '@/components/SosAlertBanner';
import { useAuth } from '@/lib/auth-context';
import { useLiveConnections } from '@/hooks/useLiveConnections';
import { pairingApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { channelStatus } from '@/components/StatusPill';
import { formatRelative } from '@/lib/format';

export default function ConnectionsPage(): React.JSX.Element {
  const { accessToken } = useAuth();
  const { pairings, snapshots, sosAlerts, dismissSos, connected, loading, error, refresh } =
    useLiveConnections(accessToken);
  const [actionError, setActionError] = useState<string | null>(null);

  const confirm = useCallback(
    async (pairingId: string) => {
      setActionError(null);
      try {
        await pairingApi.confirm(pairingId);
        await refresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      }
    },
    [refresh],
  );

  const pending = pairings.filter((p) => p.status === 'PENDING' && p.role === 'GUARDIAN');
  const active = pairings.filter((p) => p.status === 'ACTIVE');
  const ended = pairings.filter((p) => p.status === 'REVOKED');

  return (
    <AppShell connected={connected}>
      <SosAlertBanner
        alerts={sosAlerts}
        nameFor={(pid) =>
          pairings.find((p) => p.id === pid)?.monitoredUser.displayName ?? 'someone'
        }
        onDismiss={dismissSos}
      />

      <h1 className="mt-2 text-2xl font-bold">Connections</h1>

      {error && (
        <p role="alert" className="mt-4 text-sm text-live">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-4 text-sm text-live">
          {actionError}
        </p>
      )}

      {pending.length > 0 && (
        <section className="mt-6 rounded-xl border border-locked/40 bg-locked/5 p-5">
          <h2 className="text-lg font-semibold text-locked">Waiting for your confirmation</h2>
          <p className="mt-1 text-sm text-muted">
            They entered your code. Confirm it is the right person before anything is shared.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ink px-3 py-2"
              >
                <span>
                  <strong>{p.monitoredUser.displayName}</strong>
                  <span className="block text-xs text-muted">
                    redeemed {formatRelative(p.createdAt)}
                  </span>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => void confirm(p.id)}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => void pairingApi.revoke(p.id, 'Rejected by guardian').then(refresh)}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section>
          <h2 className="text-lg font-semibold">Active</h2>
          {loading && <p className="mt-2 text-sm text-muted">Loading…</p>}
          {!loading && active.length === 0 && (
            <p className="mt-2 text-sm text-muted">
              No active connections. Generate a code to connect a device.
            </p>
          )}

          <ul className="mt-3 space-y-3">
            {active.map((p) => {
              const snapshot = snapshots[p.id];
              const shielded = snapshot?.masterShieldActive ?? false;
              return (
                <li key={p.id}>
                  <Link
                    href={`/connections/${p.id}`}
                    className="block rounded-xl border border-line bg-ink-raised p-4 transition hover:border-accent"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-base">{p.monitoredUser.displayName}</strong>
                      {shielded && (
                        <span className="rounded-full border border-line px-2.5 py-1 text-xs text-muted">
                          Privacy Shield on
                        </span>
                      )}
                    </div>
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      {(['LOCATION', 'CAMERA', 'MICROPHONE'] as const).map((channel) => (
                        <span key={channel}>
                          {channel[0]}
                          {channel.slice(1).toLowerCase()}:{' '}
                          {channelStatus(snapshot, channel) === 'ON'
                            ? 'on'
                            : channelStatus(snapshot, channel) === 'LOCKED'
                              ? 'locked on'
                              : 'off'}
                        </span>
                      ))}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>

          {ended.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold">Ended</h2>
              <ul className="mt-3 space-y-2">
                {ended.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg border border-line px-3 py-2 text-sm text-muted"
                  >
                    {p.monitoredUser.displayName} — ended{' '}
                    {p.revokedAt ? formatRelative(p.revokedAt) : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <PairingGenerator onChanged={() => void refresh()} />
      </div>
    </AppShell>
  );
}

'use client';

/**
 * Sensor status and controls.
 *
 * The request buttons are enabled from the server snapshot, never from local
 * optimism. This is the blueprint's state-synchronisation problem: the moment
 * the monitored person flips a switch, `privacy:state` arrives and the button
 * disables itself, so a guardian is not left firing commands at a device that
 * is already refusing them.
 *
 * A refusal that does slip through the gap is rendered as a calm status, not
 * an error. "Privacy Shield is on" is the system working correctly, and
 * dressing it as a failure teaches guardians to treat consent as a fault.
 */

import { useCallback, useState } from 'react';
import { sensorApi, privacyApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { requestSensor } from '@/lib/socket';
import { StatusPill } from './StatusPill';
import { canRequestStream, channelStatus } from '@/lib/channel-status';
import { CHANNEL_LABELS } from '@/lib/format';
import type { PrivacyChannel, PrivacySnapshot, SensorKind } from '@/lib/types';

const CHANNELS: PrivacyChannel[] = ['LOCATION', 'CAMERA', 'MICROPHONE'];

interface Props {
  pairingId: string;
  snapshot: PrivacySnapshot | undefined;
  liveKinds: string[];
  onChanged: () => void;
}

export function SensorPanel({
  pairingId,
  snapshot,
  liveKinds,
  onChanged,
}: Props): React.JSX.Element {
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busyKind, setBusyKind] = useState<SensorKind | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  const request = useCallback(
    async (kind: SensorKind) => {
      setBusyKind(kind);
      setNotice(null);
      try {
        // Socket path first: lower latency and the same server-side gate.
        const ack = await requestSensor(pairingId, kind);
        if (ack.ok) {
          setNotice({
            tone: 'info',
            text: `${CHANNEL_LABELS[kind]} check-in requested. Their device is showing an indicator.`,
          });
          return;
        }

        if (ack.error === 'DISCONNECTED' || ack.error === 'NO_RESPONSE') {
          // Fall back to REST so a dropped socket does not block the action.
          await sensorApi.request(pairingId, kind);
          setNotice({ tone: 'info', text: `${CHANNEL_LABELS[kind]} check-in requested.` });
          return;
        }

        setNotice({ tone: 'info', text: ack.message ?? 'The request was declined.' });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PRIVACY_SHIELD_ACTIVE') {
          setNotice({ tone: 'info', text: err.message });
        } else {
          setNotice({
            tone: 'error',
            text: err instanceof ApiError ? err.message : 'Could not reach the server.',
          });
        }
      } finally {
        setBusyKind(null);
        onChanged();
      }
    },
    [pairingId, onChanged],
  );

  const toggleLock = useCallback(
    async (channel: PrivacyChannel) => {
      if (!snapshot) return;
      const current = snapshot.guardianLockedChannels;
      const next = current.includes(channel)
        ? current.filter((c) => c !== channel)
        : [...current, channel];

      setLockBusy(true);
      setNotice(null);
      try {
        await privacyApi.setLocks(pairingId, next);
        onChanged();
      } catch (err) {
        setNotice({
          tone: 'error',
          text: err instanceof ApiError ? err.message : 'Could not reach the server.',
        });
      } finally {
        setLockBusy(false);
      }
    },
    [pairingId, snapshot, onChanged],
  );

  const guardianManaged = snapshot?.tier === 'GUARDIAN_MANAGED';

  return (
    <section className="rounded-xl border border-line bg-ink-raised p-5">
      <h2 className="text-lg font-semibold">Sensors</h2>
      <p className="mt-1 text-sm text-muted">
        What they are currently sharing. Every request below is recorded in the activity log,
        which they can see too.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {CHANNELS.map((channel) => {
          const status = channelStatus(snapshot, channel);
          const live = liveKinds.includes(channel);
          const canRequest = channel !== 'LOCATION' && canRequestStream(status) && !busyKind;

          return (
            <div
              key={channel}
              className={`rounded-lg border p-4 ${
                live ? 'border-live bg-live/10' : 'border-line bg-ink'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{CHANNEL_LABELS[channel]}</span>
                {live && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-live">
                    <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-live" />
                    LIVE
                  </span>
                )}
              </div>

              <div className="mt-2">
                <StatusPill status={status} />
              </div>

              {channel !== 'LOCATION' && (
                <button
                  onClick={() => void request(channel as SensorKind)}
                  disabled={!canRequest}
                  className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-30"
                  aria-describedby={`${channel}-state`}
                >
                  {busyKind === channel ? 'Requesting…' : 'Request check-in'}
                </button>
              )}

              <p id={`${channel}-state`} className="sr-only">
                {status === 'ON'
                  ? 'Available'
                  : status === 'LOCKED'
                    ? 'Locked on by you'
                    : 'Not available right now'}
              </p>
            </div>
          );
        })}
      </div>

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            notice.tone === 'error'
              ? 'border-live/40 bg-live/10 text-live'
              : 'border-line bg-ink text-muted'
          }`}
        >
          {notice.text}
        </p>
      )}

      {guardianManaged && (
        <div className="mt-5 rounded-lg border border-locked/40 bg-locked/5 p-4">
          <h3 className="text-sm font-semibold text-locked">Channel locks</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            This is a guardian-managed connection, which {snapshot?.pairingStatus === 'ACTIVE' ? 'they' : 'the other person'} chose and can
            change back at any time. A locked channel stays on even if they turn it off — but
            they can still end the connection entirely without your approval, and their device
            still shows an indicator whenever anything is live.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(['LOCATION', 'CAMERA', 'MICROPHONE'] as PrivacyChannel[]).map((channel) => {
              const locked = snapshot?.guardianLockedChannels.includes(channel) ?? false;
              return (
                <button
                  key={channel}
                  onClick={() => void toggleLock(channel)}
                  disabled={lockBusy}
                  aria-pressed={locked}
                  className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${
                    locked
                      ? 'border-locked bg-locked/20 text-locked'
                      : 'border-line text-muted hover:border-locked/60'
                  }`}
                >
                  {locked ? `${CHANNEL_LABELS[channel]} locked` : `Lock ${CHANNEL_LABELS[channel]}`}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

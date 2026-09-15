'use client';

/**
 * The live check-in view.
 *
 * Two things this deliberately does NOT offer: a record button and a
 * screenshot button. A check-in is a moment someone consented to, not an
 * archive they consented to; capturing it would turn a momentary disclosure
 * into a permanent one without a second consent. If that is ever added it
 * needs its own consent flow and its own audit action, not a quiet button
 * here.
 */

import { useEffect, useRef } from 'react';
import { CHANNEL_LABELS } from '@/lib/format';
import type { LiveStatus, LiveStream } from '@/hooks/useLiveStream';

const END_REASONS: Record<string, string> = {
  SHIELD_RAISED: 'they raised the Privacy Shield',
  CHANNEL_OFF: 'they switched that channel off',
  PAIRING_REVOKED: 'the connection was ended',
  PAIRING_GONE: 'the connection no longer exists',
  PEER_ENDED: 'their device ended it',
  ENDED: 'their device ended it',
  CONNECTION_FAILED: 'the connection could not be established',
  SETUP_FAILED: 'the connection could not be set up',
  START_FAILED: 'their device could not start the camera or microphone',
};

interface Props {
  live: LiveStream | null;
  status: LiveStatus;
  lastEndReason: string | null;
  onStop(): void;
}

export function LiveStreamPanel({
  live,
  status,
  lastEndReason,
  onStop,
}: Props): React.JSX.Element | null {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = mediaRef.current;
    if (el) el.srcObject = live?.stream ?? null;
  }, [live]);

  // Tracks are negotiated well before media actually flows, so "a panel is
  // showing" is not the same as "it is working". Say which it is, or a
  // failed connection looks identical to a black room.
  if (!live && status === 'connecting') {
    return (
      <section className="rounded-lg border border-line bg-card p-4" aria-live="polite">
        <p className="text-sm text-muted">Connecting to their device&hellip;</p>
      </section>
    );
  }

  if (!live) {
    if (!lastEndReason) return null;
    return (
      <section className="rounded-lg border border-line bg-card p-4" aria-live="polite">
        <p className="text-sm text-muted">
          The check-in ended &mdash; {END_REASONS[lastEndReason] ?? 'it stopped'}.
        </p>
      </section>
    );
  }

  const isCamera = live.kind === 'CAMERA';

  return (
    <section className="rounded-lg border border-live bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="inline-block h-2 w-2 rounded-full bg-live" aria-hidden="true" />
          {CHANNEL_LABELS[live.kind]} check-in is {status === 'connected' ? 'live' : 'connecting'}
        </h2>
        <button
          type="button"
          onClick={onStop}
          className="rounded-md border border-line px-3 py-2 text-sm hover:bg-ink"
        >
          End check-in
        </button>
      </div>

      {isCamera ? (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          autoPlay
          playsInline
          muted
          className="w-full rounded-md bg-black"
          aria-label="Live camera from their device"
        />
      ) : (
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          autoPlay
          controls
          className="w-full"
          aria-label="Live audio from their device"
        />
      )}

      {status !== 'connected' ? (
        <p className="mt-2 text-sm text-muted" aria-live="polite">
          Negotiating the direct connection. If this does not clear, the two devices
          cannot reach each other and a TURN relay is needed.
        </p>
      ) : null}

      <p className="mt-3 text-xs text-muted">
        This stream travels directly between their device and this browser and is encrypted
        end to end. It does not pass through the Guardian server, and it is not recorded.
        Their device is showing an indicator for as long as this is open.
      </p>
    </section>
  );
}

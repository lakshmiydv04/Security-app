'use client';

/**
 * Receives a live check-in from the monitored device.
 *
 * The device offers, this side answers. That direction is deliberate: the
 * phone owns the camera, so the phone decides when capture starts and raises
 * its indicator first. A browser-initiated offer would invert that.
 *
 * Media arrives peer-to-peer under DTLS-SRTP. It does not pass through the
 * Guardian server, which only relays the handshake, so nothing in the backend
 * can see or record the stream.
 *
 * ICE CANDIDATES MUST BE QUEUED. The device starts emitting candidates the
 * instant it calls setLocalDescription, which is before its offer has even
 * reached us. Any candidate that arrives before this side has a peer
 * connection with a remote description set is rejected - and because host
 * candidates (the local-network ones that connect two devices on the same
 * Wi-Fi) are emitted first, dropping early candidates loses precisely the ones
 * most likely to work. The symptom is a connection that negotiates tracks
 * perfectly and then shows a black frame forever.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { emitRtc, onRtc, type RtcPayload } from '@/lib/socket';
import { rtcApi } from '@/lib/endpoints';

export interface LiveStream {
  sessionId: string;
  kind: 'CAMERA' | 'MICROPHONE';
  stream: MediaStream;
}

export type LiveStatus = 'idle' | 'connecting' | 'connected' | 'failed';

export interface UseLiveStream {
  live: LiveStream | null;
  /** Negotiating vs actually carrying media - they are not the same thing. */
  status: LiveStatus;
  lastEndReason: string | null;
  stop(): void;
}

export function useLiveStream(pairingId: string): UseLiveStream {
  const [live, setLive] = useState<LiveStream | null>(null);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [lastEndReason, setLastEndReason] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<string | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const remoteReady = useRef(false);
  const iceServersRef = useRef<RTCIceServer[] | null>(null);

  // Fetch ICE config up front. Doing it when the offer arrives put an HTTP
  // round trip on the critical path, and every candidate the device sent
  // during that window was discarded.
  useEffect(() => {
    let cancelled = false;
    void rtcApi
      .ice()
      .then((config) => {
        if (!cancelled) iceServersRef.current = config.iceServers;
      })
      .catch(() => {
        /* fetched again on demand below */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teardown = useCallback((reason: string | null) => {
    const pc = pcRef.current;
    pcRef.current = null;
    sessionRef.current = null;
    pendingIce.current = [];
    remoteReady.current = false;
    if (pc) {
      pc.getReceivers().forEach((r) => r.track?.stop());
      pc.close();
    }
    setLive(null);
    setStatus('idle');
    if (reason) setLastEndReason(reason);
  }, []);

  const stop = useCallback(() => {
    const sessionId = sessionRef.current;
    if (sessionId) emitRtc('rtc:end', { pairingId, sessionId, reason: 'GUARDIAN_ENDED' });
    teardown(null);
  }, [pairingId, teardown]);

  useEffect(() => {
    let cancelled = false;

    const flushPendingIce = (pc: RTCPeerConnection): void => {
      const queued = pendingIce.current;
      pendingIce.current = [];
      for (const candidate of queued) {
        void pc.addIceCandidate(candidate).catch(() => {
          /* a stale candidate is not fatal */
        });
      }
    };

    const handleOffer = (payload: RtcPayload): void => {
      if (payload.pairingId !== pairingId || !payload.sessionId || !payload.sdp) return;
      if (!payload.kind) return;
      const sessionId = payload.sessionId;
      const kind = payload.kind;

      // Claim the session synchronously, BEFORE any await, so candidates that
      // arrive during setup are queued against it rather than dropped.
      teardown(null);
      sessionRef.current = sessionId;
      remoteReady.current = false;
      pendingIce.current = [];
      setStatus('connecting');
      setLastEndReason(null);

      void (async () => {
        try {
          const cached = iceServersRef.current;
          const iceServers: RTCIceServer[] =
            cached ?? (await rtcApi.ice().then((c) => c.iceServers));
          if (cancelled || sessionRef.current !== sessionId) return;
          iceServersRef.current = iceServers;

          const pc = new RTCPeerConnection({ iceServers });
          pcRef.current = pc;

          const inbound = new MediaStream();
          pc.ontrack = (event) => {
            inbound.addTrack(event.track);
            setLive({ sessionId, kind, stream: inbound });
          };

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              emitRtc('rtc:ice', {
                pairingId,
                sessionId,
                candidate: event.candidate.toJSON(),
              });
            }
          };

          pc.onconnectionstatechange = () => {
            switch (pc.connectionState) {
              case 'connected':
                setStatus('connected');
                break;
              case 'failed':
                setStatus('failed');
                teardown('CONNECTION_FAILED');
                break;
              case 'disconnected':
                setStatus('connecting');
                break;
              default:
                break;
            }
          };

          await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
          remoteReady.current = true;
          flushPendingIce(pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emitRtc('rtc:answer', { pairingId, sessionId, sdp: answer });
        } catch {
          teardown('SETUP_FAILED');
        }
      })();
    };

    const handleIce = (payload: RtcPayload): void => {
      if (payload.sessionId !== sessionRef.current || !payload.candidate) return;
      const pc = pcRef.current;
      // Not ready yet: hold it. See the note at the top of this file.
      if (!pc || !remoteReady.current) {
        pendingIce.current.push(payload.candidate);
        return;
      }
      void pc.addIceCandidate(payload.candidate).catch(() => {
        /* a stale candidate is not fatal */
      });
    };

    const handleEnd = (payload: RtcPayload): void => {
      if (payload.pairingId !== pairingId) return;
      // A server-sent end carries no sessionId: consent was withdrawn, so every
      // session on this pairing stops, not just a named one.
      if (payload.sessionId && payload.sessionId !== sessionRef.current) return;
      teardown(payload.reason ?? 'ENDED');
    };

    const offs = [
      onRtc('rtc:offer', handleOffer),
      onRtc('rtc:ice', handleIce),
      onRtc('rtc:end', handleEnd),
    ];

    return () => {
      cancelled = true;
      for (const off of offs) off();
      teardown(null);
    };
  }, [pairingId, teardown]);

  return { live, status, lastEndReason, stop };
}

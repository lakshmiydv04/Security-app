/**
 * The media half of a sensor check-in, on the device.
 *
 * Peer-to-peer by design: this stream goes phone -> guardian's browser under
 * DTLS-SRTP and no server, including ours, can decrypt it. Our backend only
 * relays the handshake.
 *
 * ORDER IS LOAD-BEARING. The caller raises the indicator BEFORE calling
 * start(), and nothing here touches getUserMedia until ICE servers are in
 * hand. A stream that begins before the disclosure is visible is the exact
 * failure this product exists to prevent, so this must not be reordered to
 * "save a round trip".
 *
 * A camera check-in captures VIDEO ONLY. Microphone is a separately consented
 * channel, and opening the mic because the camera was allowed would take
 * consent for one thing as consent for another.
 */

import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
} from 'react-native-webrtc';
import { request } from '../api/client';
import { emitRtc, onRtc, type RtcUnsubscribe } from './socket';

export type MediaKind = 'CAMERA' | 'MICROPHONE';

/** react-native-webrtc's own shape; it has no DOM lib to borrow from. */
interface SdpInit {
  sdp: string;
  type: string | null;
}

interface IceCandidateLike {
  toJSON?: () => unknown;
}

interface IceResponse {
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  turnConfigured: boolean;
}

export interface MediaSession {
  sessionId: string;
  kind: MediaKind;
  stop(reason?: string): Promise<void>;
}

export interface StartOptions {
  pairingId: string;
  kind: MediaKind;
  /** Called when the session ends for any reason, including remotely. */
  onEnded(reason: string): void;
}

const newSessionId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function startMediaSession(opts: StartOptions): Promise<MediaSession> {
  const { pairingId, kind, onEnded } = opts;
  const sessionId = newSessionId();

  const ice = await request<IceResponse>('/api/rtc/ice');

  const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
  let stream: MediaStream | null = null;
  let closed = false;
  const subscriptions: RtcUnsubscribe[] = [];

  // Candidates from the guardian can arrive before the answer has been
  // applied. addIceCandidate rejects those, and they are exactly the host
  // candidates most likely to connect two devices on the same network, so
  // they are held until the remote description exists.
  let remoteReady = false;
  const pendingIce: unknown[] = [];

  const flushPendingIce = (): void => {
    const queued = pendingIce.splice(0, pendingIce.length);
    for (const candidate of queued) {
      void pc.addIceCandidate(candidate).catch(() => undefined);
    }
  };

  const teardown = async (reason: string, notifyPeer: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const off of subscriptions) off();
    // Release the hardware first. Stopping the tracks is what turns the OS
    // camera indicator off, and it must not wait on any network call.
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    if (notifyPeer) void emitRtc('rtc:end', { pairingId, sessionId, reason });
    onEnded(reason);
  };

  subscriptions.push(
    onRtc('rtc:answer', (payload) => {
      if (payload.sessionId !== sessionId || !payload.sdp) return;
      void pc
        .setRemoteDescription(payload.sdp as SdpInit)
        .then(() => {
          remoteReady = true;
          flushPendingIce();
        })
        .catch(() => undefined);
    }),
    onRtc('rtc:ice', (payload) => {
      if (payload.sessionId !== sessionId || !payload.candidate) return;
      if (!remoteReady) {
        pendingIce.push(payload.candidate);
        return;
      }
      // addIceCandidate accepts the plain object the peer sent.
      void pc.addIceCandidate(payload.candidate).catch(() => undefined);
    }),
    onRtc('rtc:end', (payload) => {
      if (payload.pairingId !== pairingId) return;
      // A server-sent end carries no sessionId: consent was withdrawn, so every
      // session on this pairing stops, not just a named one.
      if (payload.sessionId && payload.sessionId !== sessionId) return;
      void teardown(payload.reason ?? 'PEER_ENDED', false);
    }),
  );

  pc.onicecandidate = (event: unknown) => {
    const candidate = (event as { candidate?: IceCandidateLike | null }).candidate;
    if (!candidate) return;
    // toJSON produces a plain object that survives the socket.io hop; the
    // RTCIceCandidate instance itself does not serialise reliably.
    void emitRtc('rtc:ice', {
      pairingId,
      sessionId,
      candidate: typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate,
    });
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'failed' || state === 'closed') {
      void teardown(state === 'failed' ? 'CONNECTION_FAILED' : 'CLOSED', false);
    }
  };

  try {
    // Camera means camera. Audio stays off unless the microphone channel is
    // what was consented to.
    stream = (await mediaDevices.getUserMedia({
      video: kind === 'CAMERA' ? { facingMode: 'user' } : false,
      audio: kind === 'MICROPHONE',
    })) as MediaStream;

    const active = stream;
    active.getTracks().forEach((track) => pc.addTrack(track, active));

    const offer = (await pc.createOffer()) as SdpInit;
    await pc.setLocalDescription(offer);

    const ack = await emitRtc('rtc:offer', { pairingId, sessionId, kind, sdp: offer });

    if (ack && ack.ok === false) {
      await teardown(String(ack.error ?? 'REFUSED'), false);
      throw new Error(String(ack.message ?? ack.error ?? 'The server refused the stream.'));
    }
  } catch (err) {
    await teardown('START_FAILED', false);
    throw err;
  }

  return {
    sessionId,
    kind,
    stop: (reason = 'ENDED_LOCALLY') => teardown(reason, true),
  };
}

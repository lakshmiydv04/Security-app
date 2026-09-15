'use client';

/**
 * Socket.io client.
 *
 * This is what solves the state-synchronisation problem from the blueprint:
 * when the monitored person flips a switch, `privacy:state` arrives here and
 * the request buttons disable themselves. Without it a guardian sits firing
 * commands at a device that is already refusing them, which reads as the
 * product being broken rather than as consent working.
 */

import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './api';
import type { PrivacySnapshot } from './types';

export interface SosAlert {
  alertId: string | null;
  pairingId: string;
  monitoredUserId: string;
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  triggeredAt: string;
}

export interface SocketHandlers {
  onPrivacyState(pairingId: string, snapshot: PrivacySnapshot): void;
  onIndicator(pairingId: string, kind: string, active: boolean): void;
  onConnectionChange(connected: boolean): void;
  onSosAlert(alert: SosAlert): void;
}

let socket: Socket | null = null;

export function connectSocket(accessToken: string, handlers: SocketHandlers): Socket {
  disconnectSocket();

  socket = io(API_BASE_URL, {
    auth: { token: accessToken },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  attachRtcDispatchers(socket);

  socket.on('connect', () => handlers.onConnectionChange(true));
  socket.on('disconnect', () => handlers.onConnectionChange(false));
  socket.on('connect_error', () => handlers.onConnectionChange(false));

  socket.on('privacy:state', (p: { pairingId: string; snapshot: PrivacySnapshot }) => {
    if (p?.pairingId && p.snapshot) handlers.onPrivacyState(p.pairingId, p.snapshot);
  });

  socket.on('indicator:state', (p: { pairingId: string; kind: string; active: boolean }) => {
    if (p?.pairingId) handlers.onIndicator(p.pairingId, p.kind, Boolean(p.active));
  });

  // Delivered to the pairing room AND the guardian's own room, so the same
  // alert can arrive twice; the store dedupes on alertId.
  socket.on('sos:alert', (p: SosAlert) => {
    if (p?.pairingId) handlers.onSosAlert(p);
  });

  return socket;
}

export function subscribeToPairing(pairingId: string): Promise<PrivacySnapshot | null> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve(null);
      return;
    }
    socket.emit('pairing:subscribe', { pairingId }, (res: unknown) => {
      const r = res as { ok?: boolean; privacy?: PrivacySnapshot };
      resolve(r?.ok ? (r.privacy ?? null) : null);
    });
  });
}

export interface SensorAck {
  ok: boolean;
  error?: string;
  message?: string;
  forcedByGuardianLock?: boolean;
}

/** Command path over the socket. The server runs the privacy gate first. */
export function requestSensor(
  pairingId: string,
  kind: 'CAMERA' | 'MICROPHONE',
): Promise<SensorAck> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ ok: false, error: 'DISCONNECTED', message: 'Not connected.' });
      return;
    }
    socket.emit('command:sensor', { pairingId, kind }, (res: unknown) =>
      resolve((res as SensorAck) ?? { ok: false, error: 'NO_RESPONSE' }),
    );
  });
}


/* ---------------------------------------------------------------- WebRTC */

export type RtcEvent = 'rtc:offer' | 'rtc:answer' | 'rtc:ice' | 'rtc:end';

export interface RtcPayload {
  pairingId: string;
  sessionId?: string;
  kind?: 'CAMERA' | 'MICROPHONE';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  reason?: string;
}

/**
 * Signalling only. Media never passes through the server: once the handshake
 * completes the stream goes device-to-browser under DTLS-SRTP.
 */
export function emitRtc(event: RtcEvent, payload: RtcPayload): void {
  socket?.emit(event, payload);
}

const RTC_EVENTS: RtcEvent[] = ['rtc:offer', 'rtc:answer', 'rtc:ice', 'rtc:end'];

type RtcHandler = (payload: RtcPayload) => void;

/**
 * Handlers live on the module, not on whatever socket happens to exist when
 * onRtc is called.
 *
 * This matters: the component that listens for an incoming call mounts while
 * the session is still being restored, so the socket is often still null at
 * that moment. Binding directly to the socket meant the listener was silently
 * never attached and the offer arrived to nobody. Registering here instead
 * also means listeners survive a reconnect, which replaces the socket object.
 */
const rtcListeners = new Map<RtcEvent, Set<RtcHandler>>();

function attachRtcDispatchers(target: Socket): void {
  for (const event of RTC_EVENTS) {
    target.on(event, (payload: RtcPayload) => {
      for (const handler of rtcListeners.get(event) ?? []) {
        handler(payload ?? ({} as RtcPayload));
      }
    });
  }
}

export function onRtc(event: RtcEvent, handler: RtcHandler): () => void {
  const set = rtcListeners.get(event) ?? new Set<RtcHandler>();
  set.add(handler);
  rtcListeners.set(event, set);
  return () => {
    set.delete(handler);
  };
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

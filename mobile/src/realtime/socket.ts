/**
 * Socket.io client.
 *
 * Two responsibilities that mirror the server (server/src/realtime/io.ts):
 *   - receive `privacy:state` and treat it as authoritative;
 *   - receive `command:sensor` and raise the indicator before capture starts.
 *
 * The server has already run the privacy gate before any command reaches us.
 * We re-check locally anyway: cheap, and it means a compromised or buggy
 * server still cannot start a stream the user has switched off.
 */

import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config';
import type { PrivacySnapshot } from '../api/types';
import { channelAllowed, shouldShareLocation } from '../store/reconcile';

export interface SensorCommand {
  pairingId: string;
  kind: 'CAMERA' | 'MICROPHONE';
  requestedAt: string;
  requiresIndicator: boolean;
}

export interface SocketHandlers {
  onPrivacyState(pairingId: string, snapshot: PrivacySnapshot): void;
  onSensorCommand(command: SensorCommand): void;
  onConnectionChange(connected: boolean): void;
  /** Local snapshot lookup, used for the defence-in-depth re-check. */
  getSnapshot(pairingId: string): PrivacySnapshot | null;
  /** Called when a command was refused locally despite server approval. */
  onLocalRefusal(command: SensorCommand, reason: string): void;
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

  socket.on('privacy:state', (payload: { pairingId: string; snapshot: PrivacySnapshot }) => {
    if (payload?.pairingId && payload.snapshot) {
      handlers.onPrivacyState(payload.pairingId, payload.snapshot);
    }
  });

  socket.on('command:sensor', (command: SensorCommand) => {
    if (!command?.pairingId || !command.kind) return;

    const snapshot = handlers.getSnapshot(command.pairingId);
    if (!channelAllowed(snapshot, command.kind)) {
      handlers.onLocalRefusal(command, 'LOCAL_STATE_DENIES');
      return;
    }
    handlers.onSensorCommand(command);
  });

  return socket;
}

export function subscribeToPairing(pairingId: string): Promise<PrivacySnapshot | null> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve(null);
      return;
    }
    socket
      .timeout(10_000)
      .emit('pairing:subscribe', { pairingId }, (err: unknown, res: unknown) => {
        // A dropped socket discards pending acks. Without the timeout this
        // promise never settles and the refresh spinner spins forever.
        if (err) {
          resolve(null);
          return;
        }
        const ok = (res as { ok?: boolean; privacy?: PrivacySnapshot })?.ok;
        resolve(ok ? ((res as { privacy: PrivacySnapshot }).privacy ?? null) : null);
      });
  });
}

/** Tell the pairing room that a local toggle moved; the server re-reads truth. */
export function announcePrivacyChange(pairingId: string): void {
  socket?.emit('privacy:changed', { pairingId });
}

/** Report indicator state so the guardian dashboard can show it too. */
export function reportIndicator(
  pairingId: string,
  kind: 'CAMERA' | 'MICROPHONE',
  active: boolean,
): void {
  socket?.emit('indicator:state', { pairingId, kind, active });
}

export function disconnectSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

/* ---------------------------------------------------------------- WebRTC */

export type RtcEvent = 'rtc:offer' | 'rtc:answer' | 'rtc:ice' | 'rtc:end';

export interface RtcPayload {
  pairingId: string;
  sessionId?: string;
  kind?: string;
  sdp?: unknown;
  candidate?: unknown;
  reason?: string;
}

export interface RtcAck {
  ok?: boolean;
  error?: string;
  message?: string;
}

export type RtcUnsubscribe = () => void;

/**
 * Relay a signalling message.
 *
 * Only the offer is acknowledged: it is the one the server gates, so its
 * refusal has to reach us. Candidates and hang-ups are fire-and-forget -
 * waiting on dozens of candidate acks would add latency for nothing.
 */
export function emitRtc(event: RtcEvent, payload: RtcPayload): Promise<RtcAck | null> {
  return new Promise((resolve) => {
    if (!socket) {
      resolve(null);
      return;
    }
    if (event !== 'rtc:offer') {
      socket.emit(event, payload);
      resolve(null);
      return;
    }
    socket.timeout(10_000).emit(event, payload, (err: unknown, res: unknown) => {
      resolve(
        err
          ? { ok: false, error: 'TIMEOUT', message: 'The server did not answer the offer.' }
          : ((res as RtcAck | undefined) ?? null),
      );
    });
  });
}

const RTC_EVENTS: RtcEvent[] = ['rtc:offer', 'rtc:answer', 'rtc:ice', 'rtc:end'];

type RtcHandler = (payload: RtcPayload) => void;

/**
 * Handlers live on the module, not on whatever socket exists at the moment
 * onRtc is called. A reconnect replaces the socket object, and binding
 * directly to it meant a call in progress lost its signalling the instant
 * the connection blipped - the stream would then hang with the indicator
 * still lit, which is the worst of both worlds.
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

export function onRtc(event: RtcEvent, handler: RtcHandler): RtcUnsubscribe {
  const set = rtcListeners.get(event) ?? new Set<RtcHandler>();
  set.add(handler);
  rtcListeners.set(event, set);
  return () => {
    set.delete(handler);
  };
}

export { shouldShareLocation };

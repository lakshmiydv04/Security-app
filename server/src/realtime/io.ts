/**
 * Socket.io signalling.
 *
 * Three jobs:
 *   1. Route guardian commands to the target device - always through the same
 *      server-side privacy gate the REST routes use. A socket is not a
 *      shortcut past enforcement.
 *   2. Push privacy-state changes to guardians the instant they happen, so the
 *      dashboard disables its own buttons rather than firing commands at a
 *      device that will refuse them.
 *   3. Tell guardians when a monitored device connection appears or drops, so a
 *      device that is swiped away or killed does not go dark silently. This
 *      rides Socket.IO's own keepalive, so it works even when the device gets
 *      no chance to report anything.
 */

import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { prisma } from '../lib/db.js';
import { loadEnv } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { createPresenceStore, type PresenceStore } from '../lib/presence.js';
import { verifyAccessToken } from '../domain/tokens.js';
import { loadSnapshot, resolvePrivacy } from '../domain/privacy-service.js';
import { requireParticipant } from '../http/guards.js';
import { clearEmitter, registerEmitter } from './emitter.js';
import { pairingRoom, userRoom } from './rooms.js';
import { endCallsNoLongerPermitted, registerRtcHandlers } from './rtc-signalling.js';
import { notifyDevicePresence } from './device-presence.js';
import { markSeen } from './last-seen.js';

export interface RealtimeServer {
  io: Server;
  presence: PresenceStore;
  close(): Promise<void>;
}

export function attachRealtime(httpServer: HttpServer): RealtimeServer {
  const env = loadEnv();
  const presence = createPresenceStore();

  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
    // Tightened from the defaults (25s / 20s) so a device whose process is
    // killed - the exact case a safety app must catch - is detected as gone in
    // ~30s rather than ~45s. The foreground service keeps the process (and this
    // socket) alive while the app is merely backgrounded, so a live device does
    // not trip these.
    pingInterval: 20_000,
    pingTimeout: 10_000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    try {
      socket.data.userId = verifyAccessToken(token).sub;
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  // REST routes emit through this rather than importing io directly.
  registerEmitter(io);

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;

    // Presence transition -> tell guardians the moment a monitored device
    // appears. The online check runs BEFORE this socket is added, so a second
    // tab or a quick reconnect does not fire a spurious "online" the guardian
    // would see as a flap.
    void (async () => {
      try {
        const wasOnline = await presence.isOnline(userId);
        await presence.addSocket(userId, socket.id);
        markSeen(userId);
        if (!wasOnline) {
          await notifyDevicePresence(userId, true, 'CONNECTED');
        }
      } catch (err) {
        logger.warn({ err, userId }, 'online presence handling failed');
      }
    })();

    void socket.join(userRoom(userId));

    // WebRTC offer/answer/ICE relay. Media never touches this server.
    registerRtcHandlers(io, socket, userId);

    socket.on('disconnect', () => {
      // Presence transition -> tell guardians when the LAST socket for this
      // user goes away. This is the authoritative "device went dark" signal:
      // it fires whether the app was force-stopped, lost signal, or died with
      // its battery, none of which send a beacon.
      void (async () => {
        try {
          await presence.removeSocket(userId, socket.id);
          const stillOnline = await presence.isOnline(userId);
          if (!stillOnline) {
            await notifyDevicePresence(userId, false, 'DISCONNECTED');
          }
        } catch (err) {
          logger.warn({ err, userId }, 'offline presence handling failed');
        }
      })();
    });

    // Application-level liveness ping from the device. Socket.IO's own ping is
    // what DETECTS a dead device; this only refreshes the "last seen" clock the
    // dashboard shows and keeps a mobile carrier's NAT from reaping an idle
    // socket while the foreground service holds the app alive in the background.
    socket.on('device:heartbeat', () => markSeen(userId));

    /** Device or dashboard subscribes to a pairing it belongs to. */
    socket.on('pairing:subscribe', async (raw: unknown, ack?: (r: unknown) => void) => {
      const pairingId = typeof raw === 'string' ? raw : (raw as { pairingId?: string })?.pairingId;
      if (!pairingId) {
        ack?.({ ok: false, error: 'PAIRING_ID_REQUIRED' });
        return;
      }
      try {
        await requireParticipant(pairingId, userId);
        await socket.join(pairingRoom(pairingId));
        ack?.({ ok: true, privacy: await loadSnapshot(pairingId) });
      } catch {
        ack?.({ ok: false, error: 'NOT_FOUND' });
      }
    });

    /**
     * The monitored device reports a local toggle change. We do not trust the
     * payload - we re-read the authoritative state and broadcast that, so a
     * lying client cannot convince a dashboard that sharing is on.
     */
    socket.on('privacy:changed', async (raw: unknown) => {
      const pairingId = (raw as { pairingId?: string })?.pairingId;
      if (!pairingId) return;
      try {
        await requireParticipant(pairingId, userId);
        const snapshot = await loadSnapshot(pairingId);
        io.to(pairingRoom(pairingId)).emit('privacy:state', { pairingId, snapshot });

        // Withdrawing permission must stop a call already in progress, not
        // merely prevent the next one. Both ends are told; the device stops
        // capturing regardless of what the guardian browser does.
        endCallsNoLongerPermitted(io, pairingId, snapshot);
      } catch (err) {
        logger.debug({ err }, 'privacy:changed from non-participant ignored');
      }
    });

    /**
     * Guardian asks a device for a sensor stream. Gate first, route second.
     * A denial is returned to the guardian and never reaches the device.
     */
    socket.on('command:sensor', async (raw: unknown, ack?: (r: unknown) => void) => {
      const { pairingId, kind } = (raw ?? {}) as { pairingId?: string; kind?: string };
      if (!pairingId || (kind !== 'CAMERA' && kind !== 'MICROPHONE')) {
        ack?.({ ok: false, error: 'BAD_REQUEST' });
        return;
      }

      try {
        const participation = await requireParticipant(pairingId, userId);
        if (participation.role !== 'GUARDIAN') {
          ack?.({ ok: false, error: 'GUARDIAN_ONLY' });
          return;
        }

        const decision = await resolvePrivacy(pairingId, kind, { userId, role: 'GUARDIAN' });
        if (!decision.allowed) {
          ack?.({ ok: false, error: decision.reason, message: decision.message });
          return;
        }

        io.to(userRoom(participation.monitoredUserId)).emit('command:sensor', {
          pairingId,
          kind,
          requestedAt: new Date().toISOString(),
          // The device must raise its own visible indicator on receipt. The OS
          // indicator is the real guarantee; this drives the in-app banner.
          requiresIndicator: true,
        });
        ack?.({ ok: true, forcedByGuardianLock: decision.forcedByGuardianLock });
      } catch (err) {
        logger.debug({ err }, 'command:sensor rejected');
        ack?.({ ok: false, error: 'NOT_FOUND' });
      }
    });

    /** Device confirms its indicator is lit and the stream is live. */
    socket.on('indicator:state', async (raw: unknown) => {
      const { pairingId, active, kind } = (raw ?? {}) as {
        pairingId?: string;
        active?: boolean;
        kind?: string;
      };
      if (!pairingId) return;
      try {
        await requireParticipant(pairingId, userId);
        io.to(pairingRoom(pairingId)).emit('indicator:state', {
          pairingId,
          kind,
          active: Boolean(active),
        });
      } catch {
        /* not a participant: ignore */
      }
    });
  });

  return {
    io,
    presence,
    async close() {
      clearEmitter();
      await presence.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await prisma.$disconnect();
    },
  };
}

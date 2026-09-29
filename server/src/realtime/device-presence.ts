/**
 * Device presence -> guardian notifications.
 *
 * When a monitored user's device connection comes up or goes down, the
 * guardians on their ACTIVE pairings need to know - a safety app that silently
 * loses the device is worse than useless. This is the single place that decides
 * who to tell and records it in the audit trail.
 *
 * Two callers, by design:
 *   1. realtime/io.ts, on the socket ONLINE<->OFFLINE transition. This is the
 *      authoritative signal: it rides Socket.IO's own keepalive, so a device
 *      whose process is killed is detected WITHOUT the device reporting
 *      anything.
 *   2. the POST /api/device/connection-lost route, hit by the Android
 *      foreground service's onTaskRemoved/onDestroy beacon. That arrives sooner
 *      than the transport drop and carries a reason ("app dismissed") the drop
 *      cannot - an optimisation on top of (1), never a replacement for it.
 *
 * Emitting is best-effort through the emitter singleton, exactly like the SOS
 * path: a presence push that fails must never throw into a socket disconnect
 * handler or a REST response.
 */

import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { emitToUser } from './emitter.js';
import { lastSeenAt } from './last-seen.js';
import { appendAuditEvent } from '../domain/audit-writer.js';

export type PresenceReason =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'TASK_REMOVED'
  | 'SERVICE_DESTROYED'
  | string;

export interface DevicePresenceEvent {
  pairingId: string;
  monitoredUserId: string;
  online: boolean;
  reason: PresenceReason;
  at: string;
  /** Last app-level heartbeat we saw from this device, if any. */
  lastSeenAt: string | null;
}

/**
 * Tell every guardian of `monitoredUserId`'s ACTIVE pairings that the monitored
 * device just went online/offline, and append one audit row per pairing.
 * Returns how many pairings were notified.
 *
 * Only pairings where this user is the MONITORED party are considered - a
 * guardian's own dashboard tab closing is not a safety event.
 */
export async function notifyDevicePresence(
  monitoredUserId: string,
  online: boolean,
  reason: PresenceReason,
): Promise<number> {
  const at = new Date().toISOString();
  const seenAt = lastSeenAt(monitoredUserId);

  const pairings = await prisma.pairing.findMany({
    where: { monitoredUserId, status: 'ACTIVE' },
    select: { id: true, guardianId: true },
  });

  for (const pairing of pairings) {
    const payload: DevicePresenceEvent = {
      pairingId: pairing.id,
      monitoredUserId,
      online,
      reason,
      at,
      lastSeenAt: seenAt,
    };
    emitToUser(pairing.guardianId, 'device:presence', payload);

    // The audit log is readable by both parties and must record the device
    // going dark, not just its live streams. Best-effort: a failed audit write
    // must not stop the guardian being told.
    try {
      await appendAuditEvent({
        pairingId: pairing.id,
        actorUserId: monitoredUserId,
        actorRole: 'SYSTEM',
        action: online ? 'DEVICE_ONLINE' : 'DEVICE_OFFLINE',
        outcome: 'INFO',
        reason,
        metadata: { reason, at },
      });
    } catch (err) {
      logger.warn({ err, pairingId: pairing.id }, 'device-presence audit write failed');
    }
  }

  return pairings.length;
}

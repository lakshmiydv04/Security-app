import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { notifyDevicePresence } from '../../realtime/device-presence.js';

export const deviceRoutes = Router();
deviceRoutes.use(requireAuth);

const connectionLostSchema = z.object({
  // The Android foreground service sends TASK_REMOVED (swiped from recents) or
  // SERVICE_DESTROYED (torn down). Anything else is accepted and passed through
  // so a future client can add reasons without a server change.
  reason: z.string().min(1).max(64).optional(),
});

/**
 * Best-effort "the monitored device is going away" beacon.
 *
 * Fired natively from GuardianForegroundService.onTaskRemoved / onDestroy, in
 * the moments before the process dies - JS will not get a turn then. It is an
 * OPTIMISATION over the socket drop the server detects on its own
 * (realtime/io.ts): it arrives sooner and says WHY. Losing this beacon degrades
 * latency, not correctness.
 *
 * The caller is the monitored user, authenticated with its own bearer token, so
 * there is nothing to gate beyond authentication: a user can only report its
 * own device going dark.
 */
deviceRoutes.post(
  '/device/connection-lost',
  asyncHandler(async (req, res) => {
    const { reason } = connectionLostSchema.parse(req.body ?? {});
    const userId = currentUserId(req);
    const notifiedGuardians = await notifyDevicePresence(userId, false, reason ?? 'TASK_REMOVED');
    res.json({ ok: true, notifiedGuardians });
  }),
);

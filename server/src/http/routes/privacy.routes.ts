import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireGuardian, requireMonitored, requireParticipant } from '../guards.js';
import {
  loadSnapshot,
  setChannel,
  setGuardianLocks,
  setMasterShield,
} from '../../domain/privacy-service.js';
import { userControllableChannels } from '../../domain/privacy.js';
import { notFound } from '../../lib/errors.js';

const channelSchema = z.enum(['LOCATION', 'CAMERA', 'MICROPHONE']);

export const privacyRoutes = Router();
privacyRoutes.use(requireAuth);

/** Readable by both parties - the monitored user must be able to see exactly
 *  what the guardian sees about their own privacy state. */
privacyRoutes.get(
  '/pairings/:id/privacy',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    await requireParticipant(pairingId, currentUserId(req));
    const snapshot = await loadSnapshot(pairingId);
    if (!snapshot) throw notFound('Connection not found.');

    res.json({
      ...snapshot,
      userControllableChannels: userControllableChannels(snapshot),
    });
  }),
);

privacyRoutes.patch(
  '/pairings/:id/privacy',
  asyncHandler(async (req, res) => {
    const { channel, enabled } = z
      .object({ channel: channelSchema, enabled: z.boolean() })
      .parse(req.body);

    const pairingId = String(req.params.id);
    const participation = await requireParticipant(pairingId, currentUserId(req));
    // Only the monitored person moves their own switches. A guardian wanting a
    // channel on must use a lock, which requires the stricter tier.
    requireMonitored(participation);

    await setChannel(pairingId, channel, enabled, {
      userId: currentUserId(req),
      role: 'MONITORED',
    });
    res.json({ channel, enabled });
  }),
);

/** The kill switch. Applies across every pairing the caller is monitored on. */
privacyRoutes.put(
  '/me/master-shield',
  asyncHandler(async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    await setMasterShield(currentUserId(req), active);
    res.json({ masterShieldActive: active });
  }),
);

privacyRoutes.put(
  '/pairings/:id/locks',
  asyncHandler(async (req, res) => {
    const { locks } = z.object({ locks: z.array(channelSchema).max(3) }).parse(req.body);
    const pairingId = String(req.params.id);
    const participation = await requireParticipant(pairingId, currentUserId(req));
    requireGuardian(participation);

    await setGuardianLocks(pairingId, locks, { userId: currentUserId(req), role: 'GUARDIAN' });
    res.json({ locks });
  }),
);

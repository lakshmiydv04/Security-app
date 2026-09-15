import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireParticipant } from '../guards.js';
import {
  confirmPairing,
  createInvite,
  redeemInvite,
  revokePairing,
  setTier,
} from '../../domain/pairing.js';

export const pairingRoutes = Router();
pairingRoutes.use(requireAuth);

/** Everything the caller is part of, on either side. */
pairingRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const pairings = await prisma.pairing.findMany({
      where: { OR: [{ guardianId: userId }, { monitoredUserId: userId }] },
      include: {
        guardian: { select: { id: true, displayName: true } },
        monitoredUser: { select: { id: true, displayName: true, masterShieldActive: true } },
        privacyState: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      pairings: pairings.map((p) => ({
        id: p.id,
        status: p.status,
        tier: p.tier,
        role: p.guardianId === userId ? 'GUARDIAN' : 'MONITORED',
        guardian: p.guardian,
        monitoredUser: { id: p.monitoredUser.id, displayName: p.monitoredUser.displayName },
        privacy: p.privacyState && {
          location: p.privacyState.locationEnabled,
          camera: p.privacyState.cameraEnabled,
          microphone: p.privacyState.microphoneEnabled,
          guardianLockedChannels: p.privacyState.guardianLockedChannels,
          masterShieldActive: p.monitoredUser.masterShieldActive,
        },
        createdAt: p.createdAt,
        activatedAt: p.activatedAt,
        revokedAt: p.revokedAt,
      })),
    });
  }),
);

pairingRoutes.post(
  '/invites',
  asyncHandler(async (req, res) => {
    const invite = await createInvite(currentUserId(req));
    res.status(201).json(invite);
  }),
);

pairingRoutes.post(
  '/invites/redeem',
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().min(4).max(16) }).parse(req.body);
    const result = await redeemInvite(code, currentUserId(req));
    res.status(201).json({ ...result, status: 'PENDING' });
  }),
);

pairingRoutes.post(
  '/:id/confirm',
  asyncHandler(async (req, res) => {
    await confirmPairing(String(req.params.id), currentUserId(req));
    res.json({ status: 'ACTIVE' });
  }),
);

/** Either party, unilaterally. See domain/pairing.ts. */
pairingRoutes.post(
  '/:id/revoke',
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().max(200).nullish() }).parse(req.body ?? {});
    await revokePairing(String(req.params.id), currentUserId(req), reason ?? null);
    res.json({ status: 'REVOKED' });
  }),
);

pairingRoutes.patch(
  '/:id/tier',
  asyncHandler(async (req, res) => {
    const { tier } = z
      .object({ tier: z.enum(['SELF_MANAGED', 'GUARDIAN_MANAGED']) })
      .parse(req.body);
    await setTier(String(req.params.id), tier, currentUserId(req));
    res.json({ tier });
  }),
);

pairingRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const participation = await requireParticipant(String(req.params.id), currentUserId(req));
    res.json(participation);
  }),
);

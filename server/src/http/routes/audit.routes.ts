import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireParticipant } from '../guards.js';
import { verifyStoredChain } from '../../domain/audit-writer.js';

export const auditRoutes = Router();
auditRoutes.use(requireAuth);

/**
 * The transparency promise: identical data for guardian and monitored user.
 * There is no filter parameter that hides categories from one side, and there
 * must never be one.
 */
auditRoutes.get(
  '/pairings/:id/audit',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    await requireParticipant(pairingId, currentUserId(req));

    const { limit, before } = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        before: z.coerce.bigint().optional(),
      })
      .parse(req.query);

    const events = await prisma.auditEvent.findMany({
      where: { pairingId, ...(before ? { seq: { lt: before } } : {}) },
      orderBy: { seq: 'desc' },
      take: limit,
    });

    res.json({
      events: events.map((e) => ({
        seq: e.seq.toString(),
        action: e.action,
        channel: e.channel,
        outcome: e.outcome,
        reason: e.reason,
        actorRole: e.actorRole,
        actorUserId: e.actorUserId,
        metadata: e.metadata,
        occurredAt: e.occurredAt,
      })),
    });
  }),
);

/** Chain integrity check. Either party can run it on demand. */
auditRoutes.get(
  '/audit/verify',
  asyncHandler(async (_req, res) => {
    res.json(await verifyStoredChain());
  }),
);

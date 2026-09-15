import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/db.js';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireGuardian, requireParticipant } from '../guards.js';
import { resolvePrivacy } from '../../domain/privacy-service.js';
import { forbidden } from '../../lib/errors.js';
import type { PrivacyChannel } from '../../domain/privacy.js';

export const sensorRoutes = Router();
sensorRoutes.use(requireAuth);

const kindSchema = z.enum(['CAMERA', 'MICROPHONE']);

/**
 * Guardian requests a sensor check-in.
 *
 * The privacy gate runs BEFORE a room name or any media credential exists.
 * A denied request still creates a row and an audit event - the monitored user
 * is entitled to see that an attempt was made.
 */
sensorRoutes.post(
  '/pairings/:id/sensor-sessions',
  asyncHandler(async (req, res) => {
    const { kind } = z.object({ kind: kindSchema }).parse(req.body);
    const pairingId = String(req.params.id);
    const userId = currentUserId(req);

    const participation = await requireParticipant(pairingId, userId);
    requireGuardian(participation);

    const channel: PrivacyChannel = kind === 'CAMERA' ? 'CAMERA' : 'MICROPHONE';
    const decision = await resolvePrivacy(pairingId, channel, { userId, role: 'GUARDIAN' });

    if (!decision.allowed) {
      await prisma.sensorSession.create({
        data: {
          pairingId,
          kind,
          status: 'DENIED',
          requestedByUserId: userId,
          denialReason: decision.reason,
        },
      });
      throw forbidden('PRIVACY_SHIELD_ACTIVE', decision.message);
    }

    const session = await prisma.sensorSession.create({
      data: {
        pairingId,
        kind,
        status: 'REQUESTED',
        roomName: `sensor-${randomUUID()}`,
        requestedByUserId: userId,
      },
      select: { id: true, kind: true, status: true, roomName: true, requestedAt: true },
    });

    res.status(201).json({
      session,
      forcedByGuardianLock: decision.forcedByGuardianLock,
      // The SFU token is minted by the media service only after it re-checks
      // the gate. Never mint it here: a request is not a grant.
      mediaToken: null,
    });
  }),
);

sensorRoutes.post(
  '/sensor-sessions/:sessionId/end',
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const userId = currentUserId(req);

    const session = await prisma.sensorSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } });
      return;
    }
    // Either party can hang up; the monitored user especially.
    await requireParticipant(session.pairingId, userId);

    await prisma.sensorSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    res.json({ status: 'ENDED' });
  }),
);

sensorRoutes.get(
  '/pairings/:id/sensor-sessions',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    await requireParticipant(pairingId, currentUserId(req));
    const sessions = await prisma.sensorSession.findMany({
      where: { pairingId },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    res.json({ sessions });
  }),
);

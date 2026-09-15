import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireGuardian, requireParticipant } from '../guards.js';
import { appendAuditEvent } from '../../domain/audit-writer.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { resolvePrivacy } from '../../domain/privacy-service.js';

export const geofenceRoutes = Router();
geofenceRoutes.use(requireAuth);

const zoneSchema = z.object({
  name: z.string().min(1).max(60),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(50).max(50_000),
  notifyOnEnter: z.boolean().default(true),
  notifyOnExit: z.boolean().default(true),
});

/** Visible to both parties: a monitored user can see every zone drawn around them. */
geofenceRoutes.get(
  '/pairings/:id/geofences',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    await requireParticipant(pairingId, currentUserId(req));
    const zones = await prisma.geofenceZone.findMany({
      where: { pairingId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ zones });
  }),
);

geofenceRoutes.post(
  '/pairings/:id/geofences',
  asyncHandler(async (req, res) => {
    const body = zoneSchema.parse(req.body);
    const pairingId = String(req.params.id);
    const userId = currentUserId(req);
    requireGuardian(await requireParticipant(pairingId, userId));

    const zone = await prisma.geofenceZone.create({
      data: { ...body, pairingId, createdByUserId: userId },
    });
    await appendAuditEvent({
      pairingId,
      actorUserId: userId,
      actorRole: 'GUARDIAN',
      action: 'GEOFENCE_CREATED',
      outcome: 'INFO',
      metadata: { zoneId: zone.id, name: zone.name },
    });

    res.status(201).json({ zone });
  }),
);

geofenceRoutes.delete(
  '/pairings/:id/geofences/:zoneId',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    const zoneId = String(req.params.zoneId);
    const userId = currentUserId(req);
    requireGuardian(await requireParticipant(pairingId, userId));

    const zone = await prisma.geofenceZone.findFirst({ where: { id: zoneId, pairingId } });
    if (!zone) throw notFound('Zone not found.');

    await prisma.geofenceZone.delete({ where: { id: zoneId } });
    await appendAuditEvent({
      pairingId,
      actorUserId: userId,
      actorRole: 'GUARDIAN',
      action: 'GEOFENCE_DELETED',
      outcome: 'INFO',
      metadata: { zoneId },
    });

    res.status(204).end();
  }),
);

geofenceRoutes.get(
  '/pairings/:id/geofence-events',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    const userId = currentUserId(req);
    const participation = await requireParticipant(pairingId, userId);

    // Every geofence event carries lat/lng, so this list is location data by
    // another name and goes through the same gate - it had none before.
    const decision = await resolvePrivacy(pairingId, 'LOCATION', {
      userId,
      role: participation.role,
    });
    if (!decision.allowed && participation.role === 'GUARDIAN') {
      throw forbidden('PRIVACY_SHIELD_ACTIVE', decision.message);
    }

    const events = await prisma.geofenceEvent.findMany({
      where: { pairingId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      include: { zone: { select: { name: true } } },
    });
    res.json({ events });
  }),
);

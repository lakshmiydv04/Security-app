import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { loadEnv } from '../../lib/env.js';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireMonitored, requireParticipant } from '../guards.js';
import { resolvePrivacy } from '../../domain/privacy-service.js';
import { evaluateGeofences } from '../../domain/geofence-service.js';
import { forbidden } from '../../lib/errors.js';

export const locationRoutes = Router();
locationRoutes.use(requireAuth);

const pingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().optional(),
  capturedAt: z.coerce.date().optional(),
});

/**
 * The monitored device pushes a location ping.
 *
 * The gate is checked server-side even though the device also checks locally:
 * a modified client that ignores its own toggle must still be refused here.
 */
locationRoutes.post(
  '/pairings/:id/location',
  asyncHandler(async (req, res) => {
    const body = pingSchema.parse(req.body);
    const pairingId = String(req.params.id);
    const userId = currentUserId(req);

    const participation = await requireParticipant(pairingId, userId);
    requireMonitored(participation);

    const decision = await resolvePrivacy(pairingId, 'LOCATION', {
      userId,
      role: 'MONITORED',
    });
    if (!decision.allowed) throw forbidden('PRIVACY_SHIELD_ACTIVE', decision.message);

    const env = loadEnv();
    const capturedAt = body.capturedAt ?? new Date();

    const ping = await prisma.locationPing.create({
      data: {
        pairingId,
        lat: body.lat,
        lng: body.lng,
        accuracyMeters: body.accuracyMeters ?? null,
        capturedAt,
        expiresAt: new Date(Date.now() + env.LOCATION_RETENTION_DAYS * 86_400_000),
      },
      select: { id: true, lat: true, lng: true, capturedAt: true },
    });

    const events = await evaluateGeofences(pairingId, body.lat, body.lng);
    res.status(201).json({ ping, geofenceEvents: events });
  }),
);

locationRoutes.get(
  '/pairings/:id/location/latest',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    const participation = await requireParticipant(pairingId, currentUserId(req));

    const latest = await prisma.locationPing.findFirst({
      where: { pairingId },
      orderBy: { capturedAt: 'desc' },
    });

    // Surface the live gate state alongside the last known point so the
    // dashboard can render "Privacy Shield active" rather than a stale dot
    // that looks current.
    const snapshotDecision = await resolvePrivacy(pairingId, 'LOCATION', {
      userId: currentUserId(req),
      role: participation.role,
    });

    // The gate decides whether the point may be RELEASED, not merely how the
    // dashboard labels it. Returning coordinates alongside sharingActive:false
    // still hands over the location the shield was raised to withhold - and
    // still answers for a REVOKED pairing. The monitored person always sees
    // their own data; the gate governs disclosure to the guardian.
    const withhold = !snapshotDecision.allowed && participation.role === 'GUARDIAN';

    res.json({
      latest: withhold ? null : latest,
      sharingActive: snapshotDecision.allowed,
      ...(snapshotDecision.allowed ? {} : { reason: snapshotDecision.message }),
    });
  }),
);

locationRoutes.get(
  '/pairings/:id/location/history',
  asyncHandler(async (req, res) => {
    const pairingId = String(req.params.id);
    const userId = currentUserId(req);
    const participation = await requireParticipant(pairingId, userId);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(req.query);

    // The history is the most revealing thing this API returns - a track, not
    // a point - and it had no gate at all: a revoked guardian with an
    // unexpired access token could pull 500 points, unaudited. resolvePrivacy
    // both decides and writes the audit row.
    const decision = await resolvePrivacy(pairingId, 'LOCATION', {
      userId,
      role: participation.role,
    });
    if (!decision.allowed && participation.role === 'GUARDIAN') {
      throw forbidden('PRIVACY_SHIELD_ACTIVE', decision.message);
    }

    const pings = await prisma.locationPing.findMany({
      where: { pairingId },
      orderBy: { capturedAt: 'desc' },
      take: limit,
    });
    res.json({ pings });
  }),
);

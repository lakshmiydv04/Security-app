import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { requireParticipant } from '../guards.js';
import { appendAuditEvent } from '../../domain/audit-writer.js';
import { emitToPairing, emitToUser } from '../../realtime/emitter.js';
import { notFound } from '../../lib/errors.js';

export const sosRoutes = Router();
sosRoutes.use(requireAuth);

/**
 * Panic button.
 *
 * Deliberately NOT gated by the privacy shield: SOS is initiated by the
 * monitored person themselves, so it is an act of consent, not surveillance.
 * Sending it while the shield is up must work - that is precisely when it
 * matters most.
 */
sosRoutes.post(
  '/sos',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        accuracyMeters: z.number().nonnegative().optional(),
      })
      .parse(req.body ?? {});

    const userId = currentUserId(req);
    const pairings = await prisma.pairing.findMany({
      where: { monitoredUserId: userId, status: 'ACTIVE' },
      select: { id: true, guardianId: true },
    });

    const alerts = await Promise.all(
      pairings.map((p) =>
        prisma.sosAlert.create({
          data: {
            monitoredUserId: userId,
            pairingId: p.id,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            accuracyMeters: body.accuracyMeters ?? null,
          },
        }),
      ),
    );

    // Record one event even when there are no active pairings, so a plea that
    // reached nobody is still visible afterwards.
    if (alerts.length === 0) {
      await prisma.sosAlert.create({
        data: {
          monitoredUserId: userId,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
          accuracyMeters: body.accuracyMeters ?? null,
        },
      });
    }

    await appendAuditEvent({
      actorUserId: userId,
      actorRole: 'MONITORED',
      action: 'SOS_TRIGGERED',
      outcome: 'INFO',
      metadata: { notifiedGuardians: pairings.length },
    });

    // Push to every guardian immediately. Emitting is deliberately AFTER the
    // rows and the audit entry are committed - a guardian must never see an
    // alert that is not also on the record - but it is fire-and-forget, so a
    // socket problem cannot fail the request.
    const triggeredAt = new Date().toISOString();
    for (const [index, pairing] of pairings.entries()) {
      const alert = alerts[index];
      const payload = {
        alertId: alert?.id ?? null,
        pairingId: pairing.id,
        monitoredUserId: userId,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        accuracyMeters: body.accuracyMeters ?? null,
        triggeredAt,
      };
      emitToPairing(pairing.id, 'sos:alert', payload);
      // Also to the guardian's own room, so an SOS lands even when they are
      // not currently subscribed to that pairing's room.
      emitToUser(pairing.guardianId, 'sos:alert', payload);
    }

    res.status(201).json({ alerts, notifiedGuardians: pairings.length });
  }),
);

sosRoutes.post(
  '/sos/:alertId/acknowledge',
  asyncHandler(async (req, res) => {
    const alertId = String(req.params.alertId);
    const userId = currentUserId(req);

    const alert = await prisma.sosAlert.findUnique({ where: { id: alertId } });
    if (!alert?.pairingId) throw notFound('Alert not found.');
    await requireParticipant(alert.pairingId, userId);

    const updated = await prisma.sosAlert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date(), acknowledgedByUserId: userId },
    });

    await appendAuditEvent({
      pairingId: alert.pairingId,
      actorUserId: userId,
      actorRole: 'GUARDIAN',
      action: 'SOS_ACKNOWLEDGED',
      outcome: 'INFO',
    });

    // Tell the monitored device someone has seen it - the single most
    // reassuring thing the system can say back to them.
    emitToPairing(alert.pairingId, 'sos:acknowledged', {
      alertId,
      pairingId: alert.pairingId,
      acknowledgedAt: updated.acknowledgedAt,
    });

    res.json({ alert: updated });
  }),
);

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { ActorRole } from '../domain/audit.js';

export interface Participation {
  pairingId: string;
  guardianId: string;
  monitoredUserId: string;
  role: Extract<ActorRole, 'GUARDIAN' | 'MONITORED'>;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED';
}

/**
 * Confirms the caller is one of the two people in this pairing and reports
 * which side they are on. Every pairing-scoped route starts here - including
 * the audit read, because the log is visible to both parties and nobody else.
 */
export async function requireParticipant(
  pairingId: string,
  userId: string,
  client: PrismaClient = defaultClient,
): Promise<Participation> {
  const pairing = await client.pairing.findUnique({
    where: { id: pairingId },
    select: { id: true, guardianId: true, monitoredUserId: true, status: true },
  });
  if (!pairing) throw notFound('Connection not found.');

  if (pairing.guardianId !== userId && pairing.monitoredUserId !== userId) {
    // Same message and status as a missing pairing: do not let a caller probe
    // for the existence of connections they are not part of.
    throw notFound('Connection not found.');
  }

  return {
    pairingId: pairing.id,
    guardianId: pairing.guardianId,
    monitoredUserId: pairing.monitoredUserId,
    role: pairing.guardianId === userId ? 'GUARDIAN' : 'MONITORED',
    status: pairing.status as Participation['status'],
  };
}

export function requireGuardian(p: Participation): void {
  if (p.role !== 'GUARDIAN') throw forbidden('GUARDIAN_ONLY', 'Only the guardian can do that.');
}

export function requireMonitored(p: Participation): void {
  if (p.role !== 'MONITORED') {
    throw forbidden('MONITORED_ONLY', 'Only the person being monitored can do that.');
  }
}

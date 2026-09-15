/**
 * Consent pairing: mutual, explicit, and revocable by either side.
 *
 * Flow (both devices must act, which is what rules out a stealth install):
 *   1. Guardian generates a short-lived code.        createInvite
 *   2. Monitored user enters it on their device.     redeemInvite  -> PENDING
 *   3. Guardian confirms the specific person.        confirmPairing -> ACTIVE
 *
 * Revocation is deliberately asymmetric with creation: it takes two people to
 * build a pairing and one to end it. A monitored user never needs the
 * guardian's cooperation to disconnect.
 */

import { createHash, randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '../lib/db.js';
import { appendAuditEvent } from './audit-writer.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { PairingTier } from './privacy.js';

type Client = PrismaClient;

const INVITE_TTL_MS = 10 * 60 * 1000;
/** Crockford-style alphabet: no I, L, O, U - unambiguous when read aloud. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export function generateInviteCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function createInvite(
  guardianId: string,
  client: Client = defaultClient,
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await client.pairingInvite.create({
    data: { guardianId, codeHash: hashInviteCode(code), expiresAt },
  });

  await appendAuditEvent(
    { actorUserId: guardianId, actorRole: 'GUARDIAN', action: 'PAIRING_INVITE_CREATED', outcome: 'INFO' },
    client,
  );

  return { code, expiresAt };
}

export async function redeemInvite(
  code: string,
  monitoredUserId: string,
  client: Client = defaultClient,
): Promise<{ pairingId: string }> {
  const invite = await client.pairingInvite.findUnique({
    where: { codeHash: hashInviteCode(code) },
  });

  if (!invite || invite.consumedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw badRequest('INVALID_INVITE', 'That code is not valid or has expired.');
  }
  if (invite.guardianId === monitoredUserId) {
    throw badRequest('SELF_PAIRING', 'You cannot pair a device with itself.');
  }

  const existing = await client.pairing.findUnique({
    where: {
      guardianId_monitoredUserId: { guardianId: invite.guardianId, monitoredUserId },
    },
  });
  if (existing && existing.status !== 'REVOKED') {
    throw conflict('ALREADY_PAIRED', 'These accounts are already connected.');
  }

  const pairing = await client.$transaction(async (tx) => {
    await tx.pairingInvite.update({
      where: { id: invite.id },
      data: { consumedAt: new Date() },
    });

    if (existing) {
      return tx.pairing.update({
        where: { id: existing.id },
        data: {
          status: 'PENDING',
          tier: 'SELF_MANAGED',
          revokedAt: null,
          revokedByUserId: null,
          revokeReason: null,
        },
      });
    }

    return tx.pairing.create({
      data: { guardianId: invite.guardianId, monitoredUserId, status: 'PENDING' },
    });
  });

  await appendAuditEvent(
    {
      pairingId: pairing.id,
      actorUserId: monitoredUserId,
      actorRole: 'MONITORED',
      action: 'PAIRING_INVITE_REDEEMED',
      outcome: 'INFO',
    },
    client,
  );

  return { pairingId: pairing.id };
}

/** Second half of the handshake: the guardian confirms who redeemed the code. */
export async function confirmPairing(
  pairingId: string,
  guardianId: string,
  client: Client = defaultClient,
): Promise<void> {
  const pairing = await client.pairing.findUnique({ where: { id: pairingId } });
  if (!pairing) throw notFound('Connection not found.');
  if (pairing.guardianId !== guardianId) throw forbidden('NOT_GUARDIAN', 'Not your connection.');
  if (pairing.status !== 'PENDING') {
    throw conflict('NOT_PENDING', 'This connection is not awaiting confirmation.');
  }

  await client.$transaction(async (tx) => {
    await tx.pairing.update({
      where: { id: pairingId },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });
    // Conservative defaults: location on (the core safety feature the pairing
    // was created for), camera and microphone off until explicitly enabled.
    await tx.privacyState.upsert({
      where: { pairingId },
      create: {
        pairingId,
        locationEnabled: true,
        cameraEnabled: false,
        microphoneEnabled: false,
        updatedByUserId: guardianId,
      },
      update: {},
    });
  });

  await appendAuditEvent(
    {
      pairingId,
      actorUserId: guardianId,
      actorRole: 'GUARDIAN',
      action: 'PAIRING_ACTIVATED',
      outcome: 'INFO',
    },
    client,
  );
}

/**
 * Ends a pairing. Either party, no approval from the other, effective
 * immediately. This is the guarantee that keeps GUARDIAN_MANAGED from being
 * an abuse vector, so it must never grow a permission check beyond
 * "are you one of the two people in this pairing".
 */
export async function revokePairing(
  pairingId: string,
  actorUserId: string,
  reason: string | null,
  client: Client = defaultClient,
): Promise<void> {
  const pairing = await client.pairing.findUnique({ where: { id: pairingId } });
  if (!pairing) throw notFound('Connection not found.');

  const isParticipant =
    pairing.guardianId === actorUserId || pairing.monitoredUserId === actorUserId;
  if (!isParticipant) throw forbidden('NOT_PARTICIPANT', 'Not your connection.');

  if (pairing.status === 'REVOKED') return;

  await client.$transaction(async (tx) => {
    await tx.pairing.update({
      where: { id: pairingId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedByUserId: actorUserId,
        revokeReason: reason,
      },
    });
    // End any live sensor sessions rather than leaving orphaned rows that a
    // stale socket might still treat as authorised.
    await tx.sensorSession.updateMany({
      where: { pairingId, status: { in: ['REQUESTED', 'ACTIVE'] } },
      data: { status: 'ENDED', endedAt: new Date() },
    });
  });

  await appendAuditEvent(
    {
      pairingId,
      actorUserId,
      actorRole: pairing.monitoredUserId === actorUserId ? 'MONITORED' : 'GUARDIAN',
      action: 'PAIRING_REVOKED',
      outcome: 'INFO',
      reason,
    },
    client,
  );
}

/**
 * Tier changes always require the monitored user's action. A guardian cannot
 * escalate a connection into GUARDIAN_MANAGED on their own; de-escalation to
 * SELF_MANAGED is always available to the monitored user.
 */
export async function setTier(
  pairingId: string,
  tier: PairingTier,
  actorUserId: string,
  client: Client = defaultClient,
): Promise<void> {
  const pairing = await client.pairing.findUnique({ where: { id: pairingId } });
  if (!pairing) throw notFound('Connection not found.');
  if (pairing.monitoredUserId !== actorUserId) {
    throw forbidden(
      'TIER_REQUIRES_MONITORED_CONSENT',
      'Only the person being monitored can change how this connection is managed.',
    );
  }

  await client.$transaction(async (tx) => {
    await tx.pairing.update({ where: { id: pairingId }, data: { tier } });
    if (tier === 'SELF_MANAGED') {
      // Stepping down must clear locks, or they would linger as dead rows that
      // a later re-escalation would silently reactivate.
      await tx.privacyState.updateMany({
        where: { pairingId },
        data: { guardianLockedChannels: [] },
      });
    }
  });

  await appendAuditEvent(
    {
      pairingId,
      actorUserId,
      actorRole: 'MONITORED',
      action: 'PAIRING_TIER_CHANGED',
      outcome: 'INFO',
      metadata: { tier },
    },
    client,
  );
}

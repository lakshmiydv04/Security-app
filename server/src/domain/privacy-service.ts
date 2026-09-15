/**
 * Database-backed wrapper around the pure privacy evaluator.
 *
 * Every sensor command, location request and media-token mint calls
 * `resolvePrivacy`. Both outcomes are audited - a denial is exactly the event
 * a monitored user most wants to be able to see later, so denials are logged
 * with the same weight as grants.
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '../lib/db.js';
import { appendAuditEvent } from './audit-writer.js';
import type { ActorRole } from './audit.js';
import {
  assertLocksPermitted,
  evaluatePrivacy,
  type PairingStatus,
  type PairingTier,
  type PrivacyChannel,
  type PrivacyDecision,
  type PrivacySnapshot,
} from './privacy.js';
import { notFound, forbidden } from '../lib/errors.js';

type Client = PrismaClient;

export interface Actor {
  userId: string;
  role: ActorRole;
}

export async function loadSnapshot(
  pairingId: string,
  client: Client = defaultClient,
): Promise<PrivacySnapshot | null> {
  const pairing = await client.pairing.findUnique({
    where: { id: pairingId },
    select: {
      status: true,
      tier: true,
      privacyState: {
        select: {
          locationEnabled: true,
          cameraEnabled: true,
          microphoneEnabled: true,
          guardianLockedChannels: true,
        },
      },
      monitoredUser: { select: { masterShieldActive: true } },
    },
  });

  if (!pairing) return null;

  // A pairing with no privacy state row has not completed consent. Fail
  // closed: every channel off, nothing locked.
  const state = pairing.privacyState;

  return {
    pairingStatus: pairing.status as PairingStatus,
    tier: pairing.tier as PairingTier,
    masterShieldActive: pairing.monitoredUser.masterShieldActive,
    locationEnabled: state?.locationEnabled ?? false,
    cameraEnabled: state?.cameraEnabled ?? false,
    microphoneEnabled: state?.microphoneEnabled ?? false,
    guardianLockedChannels: (state?.guardianLockedChannels ?? []) as PrivacyChannel[],
  };
}

/**
 * THE enforcement call. Returns a decision and records it.
 *
 * Callers must treat a `false` result as final - there is deliberately no
 * override parameter, and none should ever be added.
 */
export async function resolvePrivacy(
  pairingId: string,
  channel: PrivacyChannel,
  actor: Actor,
  client: Client = defaultClient,
): Promise<PrivacyDecision> {
  const snapshot = await loadSnapshot(pairingId, client);

  if (!snapshot) {
    await appendAuditEvent(
      {
        pairingId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'SENSOR_ACCESS_CHECK',
        channel,
        outcome: 'DENIED',
        reason: 'UNKNOWN_PAIRING',
      },
      client,
    );
    throw notFound('Connection not found.');
  }

  const decision = evaluatePrivacy(snapshot, channel);

  await appendAuditEvent(
    {
      pairingId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'SENSOR_ACCESS_CHECK',
      channel,
      outcome: decision.allowed ? 'ALLOWED' : 'DENIED',
      reason: decision.allowed ? null : decision.reason,
      metadata: decision.allowed ? { forcedByGuardianLock: decision.forcedByGuardianLock } : null,
    },
    client,
  );

  return decision;
}

/** The monitored user's master kill switch. Only they may set it. */
export async function setMasterShield(
  userId: string,
  active: boolean,
  client: Client = defaultClient,
): Promise<void> {
  await client.user.update({
    where: { id: userId },
    data: { masterShieldActive: active, masterShieldUpdatedAt: new Date() },
  });

  await appendAuditEvent(
    {
      actorUserId: userId,
      actorRole: 'MONITORED',
      action: active ? 'MASTER_SHIELD_ENABLED' : 'MASTER_SHIELD_DISABLED',
      outcome: 'INFO',
    },
    client,
  );
}

/** Per-channel toggle, set by the monitored user on one pairing. */
export async function setChannel(
  pairingId: string,
  channel: PrivacyChannel,
  enabled: boolean,
  actor: Actor,
  client: Client = defaultClient,
): Promise<void> {
  const snapshot = await loadSnapshot(pairingId, client);
  if (!snapshot) throw notFound('Connection not found.');

  // A guardian-locked channel cannot be toggled off by the user. Surfaced as
  // an explicit, auditable refusal rather than a silent no-op, so the app can
  // tell them *why* the switch will not move.
  if (
    snapshot.tier === 'GUARDIAN_MANAGED' &&
    snapshot.guardianLockedChannels.includes(channel) &&
    !enabled
  ) {
    await appendAuditEvent(
      {
        pairingId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: 'CHANNEL_TOGGLE_REFUSED',
        channel,
        outcome: 'DENIED',
        reason: 'GUARDIAN_LOCKED',
      },
      client,
    );
    throw forbidden(
      'CHANNEL_GUARDIAN_LOCKED',
      'This channel is locked by your guardian. You can still end the connection entirely.',
    );
  }

  const column =
    channel === 'LOCATION'
      ? { locationEnabled: enabled }
      : channel === 'CAMERA'
        ? { cameraEnabled: enabled }
        : { microphoneEnabled: enabled };

  // upsert, not update: a pairing whose privacy row was never created would
  // otherwise fail here with Prisma P2025, which the error mapper does not
  // translate, so the person sees a 500 and a switch that will not move.
  // Creating the row on first write is both safe and the obvious recovery.
  await client.privacyState.upsert({
    where: { pairingId },
    update: { ...column, updatedByUserId: actor.userId },
    create: {
      pairingId,
      locationEnabled: false,
      cameraEnabled: false,
      microphoneEnabled: false,
      ...column,
      updatedByUserId: actor.userId,
    },
  });

  await appendAuditEvent(
    {
      pairingId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: enabled ? 'CHANNEL_ENABLED' : 'CHANNEL_DISABLED',
      channel,
      outcome: 'INFO',
    },
    client,
  );
}

/**
 * Guardian channel locks. Permitted only on GUARDIAN_MANAGED pairings, which
 * the monitored user must have consented to.
 */
export async function setGuardianLocks(
  pairingId: string,
  locks: PrivacyChannel[],
  actor: Actor,
  client: Client = defaultClient,
): Promise<void> {
  const snapshot = await loadSnapshot(pairingId, client);
  if (!snapshot) throw notFound('Connection not found.');

  try {
    assertLocksPermitted(snapshot.tier, locks);
  } catch {
    throw forbidden(
      'LOCKS_NOT_PERMITTED',
      'Channel locks require a guardian-managed connection, which the other person must consent to.',
    );
  }

  await client.privacyState.update({
    where: { pairingId },
    data: { guardianLockedChannels: locks, updatedByUserId: actor.userId },
  });

  await appendAuditEvent(
    {
      pairingId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'GUARDIAN_LOCKS_UPDATED',
      outcome: 'INFO',
      metadata: { locks },
    },
    client,
  );
}

/**
 * Database side of the audit trail. Kept apart from audit.ts so the hashing
 * and verification logic stays pure and testable without Postgres.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '../lib/db.js';
import type { PrivacyChannel } from './privacy.js';
import {
  computeEventHash,
  GENESIS_HASH,
  verifyChain,
  type ActorRole,
  type AuditOutcome,
  type ChainVerification,
} from './audit.js';

/** Arbitrary but fixed: serialises all audit appends against each other. */
const AUDIT_ADVISORY_LOCK_KEY = 0x4155_4449n;

export interface AppendAuditInput {
  pairingId?: string | null;
  actorUserId?: string | null;
  actorRole: ActorRole;
  action: string;
  channel?: PrivacyChannel | null;
  outcome: AuditOutcome;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

type Client = PrismaClient;

/**
 * Appends one event. The advisory lock is what makes the chain safe under
 * concurrency: without it two parallel appends can read the same `prevHash`
 * and fork the chain. The lock is transaction-scoped, so it releases on commit
 * or rollback with no cleanup path to forget.
 */
export async function appendAuditEvent(
  input: AppendAuditInput,
  client: Client = defaultClient,
): Promise<{ seq: bigint; hash: string }> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_ADVISORY_LOCK_KEY})`;

    const last = await tx.auditEvent.findFirst({
      orderBy: { seq: 'desc' },
      select: { hash: true },
    });
    const prevHash = last?.hash ?? GENESIS_HASH;

    const occurredAt = new Date();
    const metadata = (input.metadata ?? null) as Prisma.InputJsonValue | null;

    const hash = computeEventHash(prevHash, {
      pairingId: input.pairingId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole,
      action: input.action,
      channel: input.channel ?? null,
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata,
      occurredAt: occurredAt.toISOString(),
    });

    const created = await tx.auditEvent.create({
      data: {
        pairingId: input.pairingId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole,
        action: input.action,
        channel: input.channel ?? null,
        outcome: input.outcome,
        reason: input.reason ?? null,
        ...(metadata === null ? {} : { metadata }),
        occurredAt,
        prevHash,
        hash,
      },
      select: { seq: true, hash: true },
    });

    return created;
  });
}

/** Verifies the whole stored chain. Intended for an integrity cron / admin route. */
export async function verifyStoredChain(client: Client = defaultClient): Promise<ChainVerification> {
  const rows = await client.auditEvent.findMany({ orderBy: { seq: 'asc' } });
  return verifyChain(
    rows.map((r) => ({
      seq: r.seq,
      pairingId: r.pairingId,
      actorUserId: r.actorUserId,
      actorRole: r.actorRole as ActorRole,
      action: r.action,
      channel: r.channel as PrivacyChannel | null,
      outcome: r.outcome as AuditOutcome,
      reason: r.reason,
      metadata: r.metadata ?? null,
      occurredAt: r.occurredAt.toISOString(),
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  );
}

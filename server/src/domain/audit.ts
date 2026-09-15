/**
 * Append-only, hash-chained audit trail.
 *
 * Three independent layers, because any one of them alone is weak:
 *
 *   1. Privilege  - REVOKE UPDATE/DELETE from the app role (prisma/sql/002).
 *   2. Trigger    - BEFORE UPDATE/DELETE/TRUNCATE raises (prisma/sql/001),
 *                   which also covers owner and superuser connections.
 *   3. Hash chain - this file. Makes tampering that defeats 1 and 2 (direct
 *                   disk edit, restore from a doctored dump) *detectable*.
 *
 * The chain is only meaningful if the hash covers every field a tamperer would
 * want to change, so `auditPayload` is the single source of truth for what is
 * signed. Adding a column without adding it here silently weakens the chain.
 */

import { createHash } from 'node:crypto';
import type { PrivacyChannel } from './privacy.js';

export type ActorRole = 'GUARDIAN' | 'MONITORED' | 'SYSTEM';
export type AuditOutcome = 'ALLOWED' | 'DENIED' | 'INFO';

export const GENESIS_HASH = '0'.repeat(64);

/** A hash-relevant view of an audit event. */
export interface AuditPayload {
  pairingId: string | null;
  actorUserId: string | null;
  actorRole: ActorRole;
  action: string;
  channel: PrivacyChannel | null;
  outcome: AuditOutcome;
  reason: string | null;
  metadata: unknown;
  occurredAt: string;
}

export interface ChainedEvent extends AuditPayload {
  seq: bigint | number;
  prevHash: string;
  hash: string;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Deterministic serialisation: object keys sorted at every depth, so two
 * structurally identical payloads always hash identically regardless of how
 * the object was built. `undefined` is normalised to null.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: { [k: string]: Json } = {};
    for (const key of Object.keys(src).sort()) out[key] = normalise(src[key]);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return String(value);
}

export function computeEventHash(prevHash: string, payload: AuditPayload): string {
  return createHash('sha256').update(`${prevHash}\n${canonicalize(payload)}`).digest('hex');
}

export type ChainVerification =
  | { valid: true; length: number }
  | { valid: false; length: number; brokenAtSeq: string; problem: 'HASH_MISMATCH' | 'CHAIN_BREAK' };

/**
 * Walks a contiguous, ascending run of events and verifies both that each
 * row's own hash matches its contents and that it links to its predecessor.
 *
 * `expectedFirstPrevHash` defaults to GENESIS_HASH; pass the preceding row's
 * hash when verifying a slice rather than the whole log.
 */
export function verifyChain(
  events: readonly ChainedEvent[],
  expectedFirstPrevHash: string = GENESIS_HASH,
): ChainVerification {
  let expectedPrev = expectedFirstPrevHash;

  for (const event of events) {
    if (event.prevHash !== expectedPrev) {
      return {
        valid: false,
        length: events.length,
        brokenAtSeq: String(event.seq),
        problem: 'CHAIN_BREAK',
      };
    }
    const recomputed = computeEventHash(event.prevHash, toPayload(event));
    if (recomputed !== event.hash) {
      return {
        valid: false,
        length: events.length,
        brokenAtSeq: String(event.seq),
        problem: 'HASH_MISMATCH',
      };
    }
    expectedPrev = event.hash;
  }

  return { valid: true, length: events.length };
}

export function toPayload(event: AuditPayload): AuditPayload {
  return {
    pairingId: event.pairingId,
    actorUserId: event.actorUserId,
    actorRole: event.actorRole,
    action: event.action,
    channel: event.channel,
    outcome: event.outcome,
    reason: event.reason,
    metadata: event.metadata ?? null,
    occurredAt: event.occurredAt,
  };
}

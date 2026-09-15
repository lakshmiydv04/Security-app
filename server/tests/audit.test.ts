import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  computeEventHash,
  GENESIS_HASH,
  verifyChain,
  type AuditPayload,
  type ChainedEvent,
} from '../src/domain/audit.js';

function payload(over: Partial<AuditPayload> = {}): AuditPayload {
  return {
    pairingId: 'pair-1',
    actorUserId: 'user-1',
    actorRole: 'GUARDIAN',
    action: 'SENSOR_ACCESS_CHECK',
    channel: 'CAMERA',
    outcome: 'DENIED',
    reason: 'MASTER_SHIELD_ACTIVE',
    metadata: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** Builds a valid chain the way the writer does. */
function buildChain(payloads: AuditPayload[]): ChainedEvent[] {
  let prev = GENESIS_HASH;
  return payloads.map((p, i) => {
    const hash = computeEventHash(prev, p);
    const event: ChainedEvent = { ...p, seq: i + 1, prevHash: prev, hash };
    prev = hash;
    return event;
  });
}

describe('canonicalize', () => {
  it('is insensitive to key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalize({ x: { z: 1, y: 2 } })).toBe(canonicalize({ x: { y: 2, z: 1 } }));
  });

  it('treats undefined and null alike', () => {
    expect(canonicalize({ a: undefined })).toBe(canonicalize({ a: null }));
  });
});

describe('hash chain', () => {
  it('produces a stable hash for identical content', () => {
    expect(computeEventHash(GENESIS_HASH, payload())).toBe(
      computeEventHash(GENESIS_HASH, payload()),
    );
  });

  it('changes when any signed field changes', () => {
    const base = computeEventHash(GENESIS_HASH, payload());
    expect(computeEventHash(GENESIS_HASH, payload({ outcome: 'ALLOWED' }))).not.toBe(base);
    expect(computeEventHash(GENESIS_HASH, payload({ reason: null }))).not.toBe(base);
    expect(computeEventHash(GENESIS_HASH, payload({ actorUserId: 'user-2' }))).not.toBe(base);
  });

  it('changes when the predecessor changes', () => {
    expect(computeEventHash('a'.repeat(64), payload())).not.toBe(
      computeEventHash(GENESIS_HASH, payload()),
    );
  });

  it('verifies an untouched chain', () => {
    const chain = buildChain([payload(), payload({ outcome: 'ALLOWED' }), payload({ channel: 'MICROPHONE' })]);
    expect(verifyChain(chain)).toEqual({ valid: true, length: 3 });
  });

  it('detects an edited event', () => {
    const chain = buildChain([payload(), payload({ outcome: 'ALLOWED' })]);
    // The classic attack: flip a denial into a grant after the fact.
    const tampered = chain.map((e, i) => (i === 0 ? { ...e, outcome: 'ALLOWED' as const } : e));
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.problem).toBe('HASH_MISMATCH');
      expect(result.brokenAtSeq).toBe('1');
    }
  });

  it('detects a deleted event', () => {
    const chain = buildChain([payload(), payload({ action: 'A' }), payload({ action: 'B' })]);
    const result = verifyChain([chain[0]!, chain[2]!]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.problem).toBe('CHAIN_BREAK');
  });

  it('detects reordering', () => {
    const chain = buildChain([payload({ action: 'A' }), payload({ action: 'B' })]);
    const result = verifyChain([chain[1]!, chain[0]!]);
    expect(result.valid).toBe(false);
  });

  it('accepts an empty log', () => {
    expect(verifyChain([])).toEqual({ valid: true, length: 0 });
  });

  it('can verify a slice given its predecessor hash', () => {
    const chain = buildChain([payload(), payload({ action: 'A' }), payload({ action: 'B' })]);
    expect(verifyChain(chain.slice(1), chain[0]!.hash).valid).toBe(true);
    expect(verifyChain(chain.slice(1)).valid).toBe(false);
  });
});

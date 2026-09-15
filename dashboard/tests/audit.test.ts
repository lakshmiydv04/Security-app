import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  countEvents,
  filterEvents,
  matchesQuery,
  reasonLabel,
} from '../src/lib/audit';
import type { AuditEvent } from '../src/lib/types';

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    seq: '1',
    action: 'SENSOR_ACCESS_CHECK',
    channel: 'CAMERA',
    outcome: 'DENIED',
    reason: 'MASTER_SHIELD_ACTIVE',
    actorRole: 'GUARDIAN',
    actorUserId: 'u1',
    metadata: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('labels', () => {
  it('maps known actions to readable text', () => {
    expect(actionLabel(event({ action: 'MASTER_SHIELD_ENABLED' }))).toBe(
      'Privacy Shield turned on',
    );
  });

  it('degrades gracefully for an action it does not know', () => {
    expect(actionLabel(event({ action: 'SOME_NEW_THING' }))).toBe('some new thing');
  });

  it('translates denial reasons', () => {
    expect(reasonLabel(event())).toBe('Privacy Shield was on');
    expect(reasonLabel(event({ reason: null }))).toBeNull();
  });
});

describe('matchesQuery', () => {
  it('matches an empty query', () => {
    expect(matchesQuery(event(), '')).toBe(true);
    expect(matchesQuery(event(), '   ')).toBe(true);
  });

  it('requires every term, so extra words narrow', () => {
    expect(matchesQuery(event(), 'denied camera')).toBe(true);
    expect(matchesQuery(event(), 'denied microphone')).toBe(false);
  });

  it('is case insensitive and searches the readable label', () => {
    expect(matchesQuery(event({ action: 'SOS_TRIGGERED' }), 'sos')).toBe(true);
    expect(matchesQuery(event({ action: 'MASTER_SHIELD_ENABLED' }), 'shield')).toBe(true);
  });

  it('searches the denial reason', () => {
    expect(matchesQuery(event(), 'shield')).toBe(true);
  });
});

describe('filterEvents', () => {
  const events = [
    event({ seq: '1', outcome: 'DENIED' }),
    event({ seq: '2', outcome: 'ALLOWED', reason: null }),
    event({ seq: '3', outcome: 'INFO', action: 'GEOFENCE_CREATED', channel: null, reason: null }),
  ];

  it('returns everything on the default filter', () => {
    expect(filterEvents(events, { query: '', outcome: 'ALL' })).toHaveLength(3);
  });

  it('filters by outcome', () => {
    expect(filterEvents(events, { query: '', outcome: 'DENIED' }).map((e) => e.seq)).toEqual(['1']);
  });

  it('combines outcome and query', () => {
    expect(filterEvents(events, { query: 'camera', outcome: 'ALLOWED' }).map((e) => e.seq)).toEqual(
      ['2'],
    );
  });

  it('never invents rows', () => {
    expect(filterEvents(events, { query: 'nothing matches this', outcome: 'ALL' })).toHaveLength(0);
  });
});

describe('countEvents', () => {
  it('counts each outcome and the total', () => {
    const counts = countEvents([
      event({ outcome: 'DENIED' }),
      event({ outcome: 'DENIED' }),
      event({ outcome: 'ALLOWED' }),
      event({ outcome: 'INFO' }),
    ]);
    expect(counts).toEqual({ total: 4, allowed: 1, denied: 2, info: 1 });
  });
});

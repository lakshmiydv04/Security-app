/**
 * Audit presentation. Pure, so the filtering and labelling rules are testable
 * without a browser.
 *
 * One rule worth stating: nothing here can hide a category of event. The log
 * is shown identically to both parties by design, and a "hide denials" filter
 * would quietly break that promise for whoever is looking at it. Search
 * narrows what you are looking at; it never removes anything from the total.
 */

import type { AuditEvent, AuditOutcome } from './types';

export const ACTION_LABELS: Record<string, string> = {
  ACCOUNT_CREATED: 'Account created',
  PAIRING_INVITE_CREATED: 'Invite code generated',
  PAIRING_INVITE_REDEEMED: 'Invite code redeemed',
  PAIRING_ACTIVATED: 'Connection activated',
  PAIRING_REVOKED: 'Connection ended',
  PAIRING_TIER_CHANGED: 'Management level changed',
  SENSOR_ACCESS_CHECK: 'Sensor access check',
  CHANNEL_ENABLED: 'Channel turned on',
  CHANNEL_DISABLED: 'Channel turned off',
  CHANNEL_TOGGLE_REFUSED: 'Toggle refused',
  MASTER_SHIELD_ENABLED: 'Privacy Shield turned on',
  MASTER_SHIELD_DISABLED: 'Privacy Shield turned off',
  GUARDIAN_LOCKS_UPDATED: 'Channel locks changed',
  GEOFENCE_CREATED: 'Safe zone created',
  GEOFENCE_DELETED: 'Safe zone deleted',
  SOS_TRIGGERED: 'SOS triggered',
  SOS_ACKNOWLEDGED: 'SOS acknowledged',
};

export const DENIAL_LABELS: Record<string, string> = {
  PAIRING_REVOKED: 'Connection had ended',
  PAIRING_NOT_ACTIVE: 'Connection not active',
  MASTER_SHIELD_ACTIVE: 'Privacy Shield was on',
  CHANNEL_DISABLED: 'Channel was switched off',
  GUARDIAN_LOCKED: 'Channel locked by guardian',
  UNKNOWN_PAIRING: 'Unknown connection',
  LOCAL_STATE_DENIES: 'Device refused locally',
};

export function actionLabel(event: AuditEvent): string {
  return ACTION_LABELS[event.action] ?? event.action.replaceAll('_', ' ').toLowerCase();
}

export function reasonLabel(event: AuditEvent): string | null {
  if (!event.reason) return null;
  return DENIAL_LABELS[event.reason] ?? event.reason.replaceAll('_', ' ').toLowerCase();
}

export type OutcomeFilter = AuditOutcome | 'ALL';

export interface AuditFilter {
  query: string;
  outcome: OutcomeFilter;
}

export const EMPTY_FILTER: AuditFilter = { query: '', outcome: 'ALL' };

/** Free-text search across the fields a person would actually search by. */
export function matchesQuery(event: AuditEvent, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    actionLabel(event),
    event.action,
    event.channel ?? '',
    event.outcome,
    reasonLabel(event) ?? '',
    event.actorRole,
    event.seq,
  ]
    .join(' ')
    .toLowerCase();

  // Every whitespace-separated term must appear, so "denied camera" narrows
  // rather than widening the way an OR match would.
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

export function filterEvents(events: readonly AuditEvent[], filter: AuditFilter): AuditEvent[] {
  return events.filter(
    (e) =>
      (filter.outcome === 'ALL' || e.outcome === filter.outcome) && matchesQuery(e, filter.query),
  );
}

export interface AuditCounts {
  total: number;
  allowed: number;
  denied: number;
  info: number;
}

export function countEvents(events: readonly AuditEvent[]): AuditCounts {
  return {
    total: events.length,
    allowed: events.filter((e) => e.outcome === 'ALLOWED').length,
    denied: events.filter((e) => e.outcome === 'DENIED').length,
    info: events.filter((e) => e.outcome === 'INFO').length,
  };
}

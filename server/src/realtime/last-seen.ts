/**
 * In-memory "last heartbeat" clock, keyed by user id.
 *
 * Best-effort and deliberately not persisted: it only sharpens the dashboard's
 * "last seen 12s ago" label. The AUTHORITATIVE offline signal is the Socket.IO
 * disconnect in io.ts, so this map resetting on a redeploy costs nothing.
 */

const lastSeen = new Map<string, number>();

export function markSeen(userId: string): void {
  lastSeen.set(userId, Date.now());
}

export function lastSeenAt(userId: string): string | null {
  const t = lastSeen.get(userId);
  return t ? new Date(t).toISOString() : null;
}

export function forgetSeen(userId: string): void {
  lastSeen.delete(userId);
}

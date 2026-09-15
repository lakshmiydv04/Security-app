/**
 * Lets REST routes push socket events without importing the Socket.io server
 * (which imports the routes, via guards - a cycle).
 *
 * The io instance is registered once at startup. Before that, and in tests,
 * every emit is a silent no-op: a missing socket layer must never turn a
 * successful REST call into a failure. An SOS that is recorded but not pushed
 * is degraded; an SOS that 500s because a socket was absent is a disaster.
 */

import type { Server } from 'socket.io';

let io: Server | null = null;

export function registerEmitter(server: Server): void {
  io = server;
}

export function clearEmitter(): void {
  io = null;
}

export function emitToPairing(pairingId: string, event: string, payload: unknown): void {
  io?.to(`pairing:${pairingId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

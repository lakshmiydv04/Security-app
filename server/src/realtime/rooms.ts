/** Socket.io room names, in one place so the signalling code cannot drift. */
export const userRoom = (userId: string): string => `user:${userId}`;
export const pairingRoom = (pairingId: string): string => `pairing:${pairingId}`;

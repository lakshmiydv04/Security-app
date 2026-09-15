/**
 * Maps a user to their currently-connected sockets, so a command from the
 * dashboard can find the target device.
 *
 * Redis when REDIS_URL is set; an in-process Map otherwise. The in-process
 * store is correct for a single instance and for tests, and wrong the moment
 * you run two replicas - hence the startup warning.
 */

import Redis from 'ioredis';
import { loadEnv } from './env.js';
import { logger } from './logger.js';

export interface PresenceStore {
  addSocket(userId: string, socketId: string): Promise<void>;
  removeSocket(userId: string, socketId: string): Promise<void>;
  socketsFor(userId: string): Promise<string[]>;
  isOnline(userId: string): Promise<boolean>;
  close(): Promise<void>;
}

class MemoryPresence implements PresenceStore {
  private readonly map = new Map<string, Set<string>>();

  async addSocket(userId: string, socketId: string): Promise<void> {
    const set = this.map.get(userId) ?? new Set<string>();
    set.add(socketId);
    this.map.set(userId, set);
  }

  async removeSocket(userId: string, socketId: string): Promise<void> {
    const set = this.map.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.map.delete(userId);
  }

  async socketsFor(userId: string): Promise<string[]> {
    return [...(this.map.get(userId) ?? [])];
  }

  async isOnline(userId: string): Promise<boolean> {
    return (this.map.get(userId)?.size ?? 0) > 0;
  }

  async close(): Promise<void> {
    this.map.clear();
  }
}

class RedisPresence implements PresenceStore {
  constructor(private readonly redis: Redis) {}

  private key(userId: string): string {
    return `presence:${userId}`;
  }

  async addSocket(userId: string, socketId: string): Promise<void> {
    await this.redis.sadd(this.key(userId), socketId);
    // Expiry is a safety net for sockets lost to an ungraceful shutdown.
    await this.redis.expire(this.key(userId), 86_400);
  }

  async removeSocket(userId: string, socketId: string): Promise<void> {
    await this.redis.srem(this.key(userId), socketId);
  }

  async socketsFor(userId: string): Promise<string[]> {
    return this.redis.smembers(this.key(userId));
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.scard(this.key(userId))) > 0;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export function createPresenceStore(): PresenceStore {
  const { REDIS_URL, NODE_ENV } = loadEnv();
  if (!REDIS_URL) {
    if (NODE_ENV === 'production') {
      logger.warn('REDIS_URL is unset: presence is in-process and will break across replicas.');
    }
    return new MemoryPresence();
  }
  return new RedisPresence(new Redis(REDIS_URL, { maxRetriesPerRequest: 3 }));
}

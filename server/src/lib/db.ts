// Import order matters: loadEnv() runs dotenv, and PrismaClient reads
// DATABASE_URL at construction. Previously this module built the client
// before any importer had loaded .env, so whichever value happened to be in
// the OS environment won silently.
import { loadEnv } from './env.js';
import { PrismaClient } from '@prisma/client';

const env = loadEnv();

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    // Passed explicitly rather than left to ambient resolution, so the URL the
    // client uses is always the one loadEnv() validated.
    datasources: { db: { url: env.DATABASE_URL } },
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

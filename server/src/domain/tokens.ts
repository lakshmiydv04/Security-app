/**
 * JWT access tokens plus refresh-token rotation with reuse detection.
 *
 * Refresh tokens are stored only as SHA-256 hashes, so a database leak does
 * not hand out sessions. Each token belongs to a rotation "family"; presenting
 * an already-rotated token is treated as theft and kills the whole family.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '../lib/db.js';
import { loadEnv } from '../lib/env.js';
import { unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

type Client = PrismaClient;

export interface AccessClaims {
  sub: string;
  typ: 'access';
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function signAccessToken(userId: string): string {
  const env = loadEnv();
  const options: SignOptions = { expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'] };
  return jwt.sign({ sub: userId, typ: 'access' }, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessClaims {
  const env = loadEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (decoded.typ !== 'access' || typeof decoded.sub !== 'string') {
      throw unauthorized('Malformed token.');
    }
    return { sub: decoded.sub, typ: 'access' };
  } catch {
    throw unauthorized('Invalid or expired token.');
  }
}

export interface IssuedRefresh {
  raw: string;
  familyId: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  userId: string,
  familyId: string = randomUUID(),
  client: Client = defaultClient,
): Promise<IssuedRefresh> {
  const env = loadEnv();
  const raw = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  await client.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), familyId, expiresAt },
  });

  return { raw, familyId, expiresAt };
}

/**
 * Rotates a refresh token.
 *
 * If the presented token was already rotated or revoked, we assume it was
 * stolen and revoke every token in its family, forcing a fresh login on all
 * devices. That is the whole point of families.
 */
export async function rotateRefreshToken(
  raw: string,
  client: Client = defaultClient,
): Promise<{ userId: string; refresh: IssuedRefresh; accessToken: string }> {
  const tokenHash = hashToken(raw);
  const existing = await client.refreshToken.findUnique({ where: { tokenHash } });

  if (!existing) throw unauthorized('Invalid refresh token.');

  if (existing.revokedAt || existing.replacedByTokenId) {
    logger.warn(
      { userId: existing.userId, familyId: existing.familyId },
      'refresh token reuse detected; revoking family',
    );
    await client.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Session expired. Please sign in again.');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Session expired. Please sign in again.');
  }

  const next = await issueRefreshToken(existing.userId, existing.familyId, client);
  const replacement = await client.refreshToken.findUnique({
    where: { tokenHash: hashToken(next.raw) },
    select: { id: true },
  });

  await client.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedByTokenId: replacement?.id ?? null },
  });

  return {
    userId: existing.userId,
    refresh: next,
    accessToken: signAccessToken(existing.userId),
  };
}

export async function revokeAllSessions(
  userId: string,
  client: Client = defaultClient,
): Promise<void> {
  await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

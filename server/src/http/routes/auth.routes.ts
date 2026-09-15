import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { asyncHandler } from '../async.js';
import { conflict, unauthorized } from '../../lib/errors.js';
import {
  issueRefreshToken,
  revokeAllSessions,
  rotateRefreshToken,
  signAccessToken,
} from '../../domain/tokens.js';
import { appendAuditEvent } from '../../domain/audit-writer.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters.'),
  displayName: z.string().min(1).max(80),
});

export const authRoutes = Router();

authRoutes.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = credentials.parse(req.body);
    const email = body.email.toLowerCase();

    if (await prisma.user.findUnique({ where: { email } })) {
      throw conflict('EMAIL_TAKEN', 'An account with that email already exists.');
    }

    const user = await prisma.user.create({
      data: {
        email,
        displayName: body.displayName,
        passwordHash: await bcrypt.hash(body.password, 12),
      },
      select: { id: true, email: true, displayName: true },
    });

    const refresh = await issueRefreshToken(user.id);
    await appendAuditEvent({
      actorUserId: user.id,
      actorRole: 'SYSTEM',
      action: 'ACCOUNT_CREATED',
      outcome: 'INFO',
    });

    res.status(201).json({
      user,
      accessToken: signAccessToken(user.id),
      refreshToken: refresh.raw,
    });
  }),
);

authRoutes.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = credentials.omit({ displayName: true }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

    // Compare against a dummy hash when the user is absent so the response
    // time does not reveal whether the address is registered.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduu';
    const ok = await bcrypt.compare(body.password, hash);

    if (!user || !ok) throw unauthorized('Incorrect email or password.');

    const refresh = await issueRefreshToken(user.id);
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accessToken: signAccessToken(user.id),
      refreshToken: refresh.raw,
    });
  }),
);

authRoutes.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    const result = await rotateRefreshToken(refreshToken);
    res.json({ accessToken: result.accessToken, refreshToken: result.refresh.raw });
  }),
);

authRoutes.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(currentUserId(req));
    res.status(204).end();
  }),
);

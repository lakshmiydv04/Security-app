import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request payload is invalid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
    return;
  }

  // Prisma's known errors carry a P#### code. A few of them mean the service
  // is misconfigured rather than the request being bad, and saying so turns an
  // opaque 500 into something actionable - without leaking schema details to
  // the browser, which is why the specifics go to the log only.
  const prismaCode = knownPrismaCode(err);

  if (prismaCode === 'P2021' || prismaCode === 'P2022') {
    logger.error(
      { err, prismaCode },
      'DATABASE SCHEMA MISSING - run `npm run prisma:migrate` then `npm run db:harden`',
    );
    res.status(503).json({
      error: {
        code: 'SERVICE_NOT_READY',
        message: 'The server is not fully set up yet. Check the server logs.',
      },
    });
    return;
  }

  if (prismaCode === 'P1001' || prismaCode === 'P1002') {
    logger.error({ err, prismaCode }, 'DATABASE UNREACHABLE');
    res.status(503).json({
      error: { code: 'SERVICE_NOT_READY', message: 'The server cannot reach its database.' },
    });
    return;
  }

  if (prismaCode === 'P2002') {
    res.status(409).json({
      error: { code: 'ALREADY_EXISTS', message: 'That record already exists.' },
    });
    return;
  }

  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
}

/**
 * Reads a Prisma error code structurally rather than importing the generated
 * Prisma namespace, so this file does not depend on `prisma generate` having
 * run and keeps working if the client moves.
 */
function knownPrismaCode(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

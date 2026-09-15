import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../../domain/tokens.js';
import { unauthorized } from '../../lib/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized());
    return;
  }
  try {
    const claims = verifyAccessToken(header.slice('Bearer '.length));
    req.userId = claims.sub;
    next();
  } catch (err) {
    next(err);
  }
}

export function currentUserId(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}

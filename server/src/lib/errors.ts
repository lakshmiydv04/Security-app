export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) =>
  new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (code: string, msg: string) => new AppError(403, code, msg);
export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
export const tooManyRequests = (msg = 'Too many requests') =>
  new AppError(429, 'RATE_LIMITED', msg);

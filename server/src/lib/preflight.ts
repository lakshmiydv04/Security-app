/**
 * Startup checks.
 *
 * Without these the server starts happily against an empty database and then
 * returns a generic 500 for every request, because the deliberate decision not
 * to leak internals to a browser also hides "the users table does not exist"
 * from the person trying to debug it. A server that refuses to start with a
 * clear reason is far more useful than one that appears healthy and fails
 * every call.
 */

import { prisma } from './db.js';
import { logger } from './logger.js';

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

function box(title: string, lines: string[]): string {
  return ['', `  ${title}`, '  ' + '-'.repeat(title.length), ...lines.map((l) => `  ${l}`), ''].join(
    '\n',
  );
}

/** Hides the password in a connection string before it reaches a log. */
function redact(url: string): string {
  return url.replace(/(:\/\/[^:@/]+:)[^@]*(@)/, '$1****$2');
}

async function assertReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const url = process.env.DATABASE_URL ?? '(unset)';
    throw new PreflightError(
      box('Cannot reach the database', [
        `Tried: ${redact(url)}`,
        '',
        'Check, in order:',
        '  1. The postgresql-x64-* service is running in Windows Services.',
        '  2. The password in .env matches the postgres role.',
        '  3. The database exists:',
        '       psql -U postgres -c "CREATE DATABASE guardian_db;"',
        '',
        `Underlying error: ${String((err as Error)?.message ?? err).split('\n')[0]}`,
      ]),
    );
  }
}

async function assertMigrated(): Promise<void> {
  try {
    await prisma.user.count();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    // P2021: table does not exist. P2022: column does not exist (partial or
    // out-of-date migration).
    if (code === 'P2021' || code === 'P2022') {
      throw new PreflightError(
        box('The database has no schema yet', [
          'The connection works, but the tables are missing, so every',
          'sign-up and sign-in would fail with a generic 500.',
          '',
          'Run:',
          '  npm run prisma:migrate     (name it "init" when prompted)',
          '  npm run db:harden',
          '',
          'Then start the server again.',
        ]),
      );
    }
    throw err;
  }
}

/**
 * The append-only guarantee is applied by a separate script, so it is easy to
 * skip. Warn loudly rather than refusing to boot: a developer poking at the
 * API locally should not be blocked, but nobody should reach production
 * believing the audit log is immutable when it is not.
 */
async function warnIfNotHardened(): Promise<void> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_trigger
      WHERE tgname IN ('audit_events_no_update', 'audit_events_no_delete', 'audit_events_no_truncate')
    `;
    const count = Number(rows[0]?.count ?? 0);
    if (count < 3) {
      logger.warn(
        { triggersFound: count, expected: 3 },
        'audit_events is NOT append-only yet - run `npm run db:harden`. ' +
          'Until then the audit log can be edited or deleted.',
      );
    }
  } catch {
    // Never let a diagnostic stop the server.
  }
}

export async function runPreflight(): Promise<void> {
  await assertReachable();
  await assertMigrated();
  await warnIfNotHardened();
  logger.info('preflight ok: database reachable and migrated');
}

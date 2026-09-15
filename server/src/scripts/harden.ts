/**
 * Applies the database-level audit immutability guarantees.
 * Run after `prisma migrate deploy`:  npm run db:harden
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prisma } from '../lib/db.js';
import { loadEnv } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { splitSqlStatements } from '../lib/sql-statements.js';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', '..', 'prisma', 'sql');

/** Triggers the preflight check expects to find on audit_events. */
const REQUIRED_TRIGGERS = 3;

/**
 * Run a SQL script one statement at a time.
 *
 * Prisma uses the extended query protocol, where a prepared statement carries
 * exactly one command - passing a whole file fails with 42601. Everything goes
 * in a single transaction so a half-applied hardening cannot happen: Postgres
 * DDL is transactional, so either all the triggers exist or none do.
 */
async function runScript(label: string, sql: string): Promise<number> {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    throw new Error(`${label}: no executable statements found`);
  }
  await prisma.$transaction(
    async (tx) => {
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
    },
    { timeout: 30_000 },
  );
  return statements.length;
}

async function main(): Promise<void> {
  const env = loadEnv();

  const triggerSql = await readFile(join(sqlDir, '001_audit_immutability.sql'), 'utf8');
  logger.info(
    { statements: await runScript('001_audit_immutability', triggerSql) },
    'audit immutability triggers applied',
  );

  if (env.APP_DB_ROLE) {
    const grants = (await readFile(join(sqlDir, '002_audit_grants.sql'), 'utf8')).replaceAll(
      '__APP_ROLE__',
      env.APP_DB_ROLE,
    );
    logger.info(
      { role: env.APP_DB_ROLE, statements: await runScript('002_audit_grants', grants) },
      'audit grants applied',
    );
  } else {
    logger.warn(
      'APP_DB_ROLE unset: privilege half of the append-only guarantee skipped. ' +
        'The trigger still blocks UPDATE/DELETE/TRUNCATE.',
    );
  }

  // Verify rather than assume. The whole product rests on this table being
  // append-only, so this script must not report success unless it is.
  const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal
    ORDER BY tgname
  `;
  const names = rows.map((r) => r.tgname);

  if (names.length < REQUIRED_TRIGGERS) {
    throw new Error(
      `expected ${REQUIRED_TRIGGERS} triggers on audit_events, found ${names.length}` +
        (names.length ? `: ${names.join(', ')}` : ''),
    );
  }

  logger.info({ triggers: names }, 'verified: audit_events is append-only');
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'harden failed');
  process.exit(1);
});

import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';
import { encodingHelp, inspectDatabaseUrl } from './db-url.js';

/**
 * Load .env BEFORE anything reads process.env.
 *
 * `override` is the important part. dotenv's default is to leave an already-set
 * variable alone, which is correct in production - a real environment variable
 * should beat a file that happened to get deployed. In development it is the
 * opposite: a stale DATABASE_URL left in the Windows environment silently beats
 * the file you are actually editing, and every tool then reports a host that
 * appears nowhere in your project. That failure is genuinely hard to find.
 *
 * So: in development the project's own .env wins. In production there is no
 * .env file and real environment variables are the only source.
 */
const isProduction = process.env.NODE_ENV === 'production';
dotenv.config({ override: !isProduction });

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Postgres)'),
  APP_DB_ROLE: z.string().default(''),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REDIS_URL: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOCATION_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // WebRTC. Media is peer-to-peer, so the server only hands out the
  // addresses peers use to find each other. STUN is enough for most
  // networks; TURN relays the (still encrypted) stream for the rest.
  STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
  TURN_URLS: z.string().default(''),
  TURN_SECRET: z.string().default(''),
  TURN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nCopy .env.example to .env and fill it in.`);
  }
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.');
  }

  assertDatabaseUrlParses(parsed.data.DATABASE_URL);
  reportEnvFileShadowing(parsed.data.DATABASE_URL);
  cached = parsed.data;
  return cached;
}

/**
 * In development the loader above has already made .env win, so reaching here
 * means an outside variable was overridden - worth saying once, because the
 * same stale variable will still confuse any tool that does its own loading.
 *
 * In production nothing is overridden, so a mismatch is a real misconfiguration
 * and the process refuses to start.
 */
function reportEnvFileShadowing(effectiveUrl: string): void {
  if (!existsSync('.env')) return;

  let fileContents: string;
  try {
    fileContents = readFileSync('.env', 'utf8');
  } catch {
    return;
  }

  const match = /^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m.exec(fileContents);
  const fromFile = match?.[1];
  if (!fromFile || fromFile === effectiveUrl) return;

  const detail = [
    '',
    `  .env says:  ${redactUrl(fromFile)}`,
    `  in effect:  ${redactUrl(effectiveUrl)}`,
    '',
    'An environment variable set outside the project disagrees with your .env.',
    'Clear it so every tool sees the same value:',
    '',
    '  [Environment]::SetEnvironmentVariable("DATABASE_URL", $null, "User")',
    '  $env:DATABASE_URL = $null',
    '',
    'Then open a new terminal. Run `npm run env:doctor` to see every source.',
  ].join('\n');

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`DATABASE_URL mismatch in production.\n${detail}`);
  }
  process.stderr.write(`\n  NOTE: .env overrode a conflicting DATABASE_URL.\n${detail}\n`);
}

/** Never print a database password, not even in a crash. */
function redactUrl(url: string): string {
  return url.replace(/(:\/\/[^:@/]+:)[^@]*(@)/, '$1****$2');
}

/**
 * Catches a DATABASE_URL that reads correctly but parses to somewhere else.
 * Checked at startup because the alternative is every tool independently
 * reporting a host that appears nowhere in your configuration.
 */
function assertDatabaseUrlParses(url: string): void {
  const result = inspectDatabaseUrl(url);
  if (result.ok) return;

  throw new Error(
    [
      '',
      '  DATABASE_URL does not parse the way it reads',
      '  ------------------------------------------',
      `  ${result.problem}`,
      '',
      '  It parses to:',
      `    host      ${result.host ?? '(none)'}`,
      `    port      ${result.port ?? '(default 5432)'}`,
      `    database  ${result.database ?? '(none - Postgres will use "postgres")'}`,
      '',
      ...encodingHelp(result.offending).map((l) => `  ${l}`),
      '',
      '  Run `npm run env:doctor` to see every source.',
      '',
    ].join('\n'),
  );
}

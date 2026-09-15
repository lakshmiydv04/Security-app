#!/usr/bin/env node
/**
 * Shows every place DATABASE_URL can come from, what each one says, and - the
 * part that matters - what each one actually PARSES to.
 *
 * A connection string can read perfectly and still parse somewhere else, because
 * a password is just text inside a URL. `#` starts a fragment, `/` and `?` end
 * the authority. When that happens every tool reports a host that appears
 * nowhere in your configuration.
 *
 * Passwords are never printed.
 *
 *   npm run env:doctor
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

const RESERVED = {
  '#': '%23',
  '/': '%2F',
  '?': '%3F',
  '@': '%40',
  ':': '%3A',
  '[': '%5B',
  ']': '%5D',
  ' ': '%20',
  '%': '%25',
};

function redact(url) {
  return String(url).replace(/(:\/\/[^:@/]+:)[^@]*(@)/, '$1****$2');
}

function inspect(raw) {
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd === -1) return { ok: false, problem: 'not a connection URL', offending: [] };

  const afterScheme = raw.slice(schemeEnd + 3);
  const lastAt = afterScheme.lastIndexOf('@');
  const userinfo = lastAt === -1 ? '' : afterScheme.slice(0, lastAt);
  const firstColon = userinfo.indexOf(':');
  const password = firstColon === -1 ? '' : userinfo.slice(firstColon + 1);
  const offending = [...new Set([...password].filter((c) => c in RESERVED))];

  let u = null;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, problem: 'UNPARSEABLE', offending, host: null, port: null, database: null };
  }

  const host = u.hostname || null;
  const database = u.pathname.replace(/^\//, '') || null;
  const intendedHostPart = lastAt === -1 ? '' : afterScheme.slice(lastAt + 1);
  const hijacked = Boolean(host) && intendedHostPart.length > 0 && !intendedHostPart.startsWith(host);

  return {
    ok: !hijacked && Boolean(database),
    problem: hijacked ? 'parses to the WRONG host' : database ? null : 'no database name',
    offending,
    host,
    port: u.port || null,
    database,
  };
}

function windowsScope(scope) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('DATABASE_URL','${scope}')`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

const fromFile = existsSync('.env')
  ? (dotenv.parse(readFileSync('.env', 'utf8')).DATABASE_URL ?? null)
  : null;

const sources = [
  ['.env file (this project)', fromFile],
  ['process environment (in effect)', process.env.DATABASE_URL ?? null],
  ['Windows User variable', windowsScope('User')],
  ['Windows Machine variable', windowsScope('Machine')],
];

process.stdout.write('\nDATABASE_URL — every source\n===========================\n\n');

let broken = null;

for (const [label, value] of sources) {
  process.stdout.write(`  ${label}\n`);
  if (!value) {
    process.stdout.write('        (not set)\n\n');
    continue;
  }
  const r = inspect(value);
  process.stdout.write(`        text:   ${redact(value)}\n`);
  process.stdout.write(
    `        parses: host=${r.host ?? '(none)'}  port=${r.port ?? '(default 5432)'}  database=${r.database ?? '(none → "postgres")'}${r.ok ? '' : '   <-- ' + r.problem}\n\n`,
  );
  if (!r.ok && !broken) broken = { label, ...r };
}

if (broken) {
  const lines = [
    '  PROBLEM — the URL does not mean what it looks like',
    '  --------------------------------------------------',
    `  Source: ${broken.label}`,
    '',
    '  The text reads correctly, but it parses to a different server. Every tool',
    '  (Prisma, psql, this app) uses the PARSED value, which is why errors name a',
    '  host that appears nowhere in your configuration.',
    '',
  ];

  if (broken.offending.length > 0) {
    lines.push(
      `  Cause: your password contains ${broken.offending.map((c) => (c === ' ' ? '(space)' : c)).join('  ')}`,
      '',
      '  These are reserved in a URL. "#" is the usual culprit — it starts a',
      '  fragment, so everything after it (including @host:port/database) is',
      '  thrown away.',
      '',
      '  Fix A — percent-encode it in .env (the password itself is unchanged):',
      ...broken.offending.map((c) => `      ${c === ' ' ? '(space)' : c}  ->  ${RESERVED[c]}`),
      '',
      '  Fix B — set a password with no reserved characters:',
      '      psql -U postgres -c "ALTER USER postgres WITH PASSWORD \'a_simple_password\';"',
      '      then update DATABASE_URL in .env to match.',
    );
  } else {
    lines.push('  Check the host, port and database name in the URL.');
  }

  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(1);
}

const outside = [sources[2][1], sources[3][1]].filter(Boolean);
if (outside.some((v) => fromFile && v !== fromFile)) {
  process.stdout.write(
    [
      '  NOTE',
      '  ----',
      '  A DATABASE_URL set outside this project disagrees with your .env.',
      '  Clear it so every tool agrees:',
      '',
      '    [Environment]::SetEnvironmentVariable("DATABASE_URL", $null, "User")',
      '    $env:DATABASE_URL = $null',
      '',
      '  Then open a NEW terminal.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

process.stdout.write('  All good: every source parses to the same, valid server.\n\n');

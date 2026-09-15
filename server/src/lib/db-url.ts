/**
 * Structural validation for DATABASE_URL.
 *
 * A connection string can be completely correct to the eye and still parse to
 * somewhere else entirely, because a password is just text sitting inside a
 * URL. `#` is the worst offender: it starts a fragment, so
 *
 *   postgresql://postgres:#secret@localhost:5432/guardian_db
 *
 * parses as host "postgres", no port, no database - everything from the `#`
 * onward is discarded. Every tool then reports a host that appears nowhere in
 * your configuration, which is close to undebuggable by reading the file.
 *
 * Passwords are never returned or printed by anything here. The offending
 * characters are named so the fix is obvious; the secret itself stays put.
 */

/** Characters that change the meaning of a URL and must be percent-encoded. */
const RESERVED: Record<string, string> = {
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

export interface UrlInspection {
  ok: boolean;
  host: string | null;
  port: string | null;
  database: string | null;
  /** Reserved characters found in the password, in the order encountered. */
  offending: string[];
  problem: string | null;
}

export function inspectDatabaseUrl(raw: string): UrlInspection {
  const base: UrlInspection = {
    ok: false,
    host: null,
    port: null,
    database: null,
    offending: [],
    problem: null,
  };

  const schemeEnd = raw.indexOf('://');
  if (schemeEnd === -1) {
    return { ...base, problem: 'It does not look like a connection URL (no "://").' };
  }

  // The password runs from the first ':' after the scheme to the LAST '@',
  // because a password may legitimately contain '@' once encoded.
  const afterScheme = raw.slice(schemeEnd + 3);
  const lastAt = afterScheme.lastIndexOf('@');
  const userinfo = lastAt === -1 ? '' : afterScheme.slice(0, lastAt);
  const firstColon = userinfo.indexOf(':');
  const password = firstColon === -1 ? '' : userinfo.slice(firstColon + 1);

  const offending = [...new Set([...password].filter((c) => c in RESERVED))];

  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      ...base,
      offending,
      problem: offending.length
        ? 'The password contains characters that make the URL unparseable.'
        : 'The URL could not be parsed.',
    };
  }

  const host = parsed.hostname || null;
  const port = parsed.port || null;
  const database = parsed.pathname.replace(/^\//, '') || null;

  // The decisive test: does the URL parse to the host that actually appears
  // after the last '@'? If not, something earlier in the string hijacked it.
  const intendedHostPart = lastAt === -1 ? '' : afterScheme.slice(lastAt + 1);
  const hijacked = Boolean(host) && intendedHostPart.length > 0 && !intendedHostPart.startsWith(host!);

  if (hijacked || !database) {
    return {
      ok: false,
      host,
      port,
      database,
      offending,
      problem: offending.length
        ? 'The password contains reserved characters, so the URL parses to the wrong server.'
        : 'The URL parses to an unexpected host or has no database name.',
    };
  }

  return { ok: true, host, port, database, offending, problem: null };
}

/** Guidance text. Never includes the password itself. */
export function encodingHelp(offending: string[]): string[] {
  if (offending.length === 0) return [];
  return [
    `Your password contains: ${offending.map((c) => (c === ' ' ? '(space)' : c)).join('  ')}`,
    '',
    'Percent-encode each one in DATABASE_URL (the password itself does not change,',
    'only how it is written in the URL):',
    '',
    ...offending.map((c) => `    ${c === ' ' ? '(space)' : c}  ->  ${RESERVED[c]}`),
    '',
    'Either encode it, or set a password with no reserved characters:',
    '    psql -U postgres -c "ALTER USER postgres WITH PASSWORD \'a_simple_password\';"',
  ];
}

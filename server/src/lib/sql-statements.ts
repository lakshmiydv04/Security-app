/**
 * Splits a SQL script into individual statements.
 *
 * Needed because Prisma sends raw SQL over the extended query protocol, where
 * one prepared statement carries exactly one command. Handing it a whole file
 * fails with Postgres 42601, "cannot insert multiple commands into a prepared
 * statement".
 *
 * A naive split(';') is wrong here: the audit trigger's function body is a
 * dollar-quoted block full of semicolons. This walks the script tracking line
 * comments, block comments, string literals, quoted identifiers and
 * dollar-quoted blocks (tag-aware, so both $$ and $tag$ work), treating only a
 * top-level semicolon as a separator.
 *
 * Pure, so it is tested without a database.
 */

/** Matches an opening dollar-quote tag: $$ or $name$. */
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** True if the chunk contains anything the server would actually execute. */
function hasExecutableContent(chunk: string): boolean {
  const withoutComments = chunk.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  return withoutComments.trim().length > 0;
}

/** Index just past a single- or double-quoted literal starting at `start`. */
function endOfQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      // A doubled quote is an escaped quote, not the end of the literal.
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  // Unterminated: hand it to Postgres and let it produce the real error.
  return sql.length;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i] as string;
    const pair = sql.slice(i, i + 2);

    if (pair === '--') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      buffer += sql.slice(i, end);
      i = end;
      continue;
    }

    if (pair === '/*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      buffer += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = endOfQuoted(sql, i, ch);
      buffer += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '$') {
      const match = DOLLAR_TAG.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? sql.length : close + tag.length;
        buffer += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    if (ch === ';') {
      statements.push(buffer);
      buffer = '';
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  statements.push(buffer);

  return statements.map((s) => s.trim()).filter(hasExecutableContent);
}

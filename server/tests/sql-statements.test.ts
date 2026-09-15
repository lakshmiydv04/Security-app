import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../src/lib/sql-statements.js';

describe('splitSqlStatements', () => {
  it('splits plain statements', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('does not split inside a dollar-quoted function body', () => {
    const sql = `
CREATE OR REPLACE FUNCTION f()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'nope: % here', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t ON audit_events;`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('RAISE EXCEPTION');
    expect(out[0]).toContain('LANGUAGE plpgsql');
    expect(out[1]).toBe('DROP TRIGGER IF EXISTS t ON audit_events');
  });

  it('handles tagged dollar quotes', () => {
    const out = splitSqlStatements('DO $body$ BEGIN PERFORM 1; END $body$; SELECT 2;');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('PERFORM 1;');
  });

  it('ignores semicolons inside string literals', () => {
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 2;")).toEqual(["SELECT 'a;b'", 'SELECT 2']);
  });

  it('treats a doubled quote as an escape, not a terminator', () => {
    expect(splitSqlStatements("SELECT 'it''s; fine'; SELECT 2;")).toEqual([
      "SELECT 'it''s; fine'",
      'SELECT 2',
    ]);
  });

  it('ignores semicolons inside quoted identifiers', () => {
    expect(splitSqlStatements('REVOKE UPDATE ON t FROM "weird;role"; SELECT 1;')).toEqual([
      'REVOKE UPDATE ON t FROM "weird;role"',
      'SELECT 1',
    ]);
  });

  it('ignores semicolons inside comments', () => {
    const out = splitSqlStatements('-- a; b\nSELECT 1; /* c; d */ SELECT 2;');
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('SELECT 2');
  });

  it('drops comment-only and empty chunks', () => {
    expect(splitSqlStatements('SELECT 1;\n-- trailing note\n')).toEqual(['SELECT 1']);
    expect(splitSqlStatements('   ;;;  ')).toEqual([]);
  });

  it('keeps a final statement with no trailing semicolon', () => {
    expect(splitSqlStatements('SELECT 1;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('splits the real hardening scripts into the expected commands', async () => {
    const { readFile } = await import('node:fs/promises');
    const triggers = await readFile('prisma/sql/001_audit_immutability.sql', 'utf8');
    const grants = await readFile('prisma/sql/002_audit_grants.sql', 'utf8');
    // 1 function + 3 x (DROP TRIGGER + CREATE TRIGGER)
    expect(splitSqlStatements(triggers)).toHaveLength(7);
    // REVOKE + GRANT
    expect(splitSqlStatements(grants)).toHaveLength(2);
  });
});

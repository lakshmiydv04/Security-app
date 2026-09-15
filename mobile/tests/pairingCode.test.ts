import { describe, expect, it } from 'vitest';
import { extractCode } from '../src/pairingCode';

describe('extractCode', () => {
  it('accepts a bare code', () => {
    expect(extractCode('ABCD1234')).toBe('ABCD1234');
  });

  it('normalises case and stray whitespace', () => {
    expect(extractCode('  abcd1234 ')).toBe('ABCD1234');
  });

  it('pulls a code out of a pairing URL', () => {
    expect(extractCode('guardian://pair?code=ABCD1234')).toBe('ABCD1234');
    expect(extractCode('https://example.com/pair?code=abcd1234&x=1')).toBe('ABCD1234');
  });

  it('rejects the ambiguous letters the server excludes', () => {
    // The server's alphabet omits I, L, O and U so codes survive being read
    // aloud; accepting them here would produce confusing server rejections.
    expect(extractCode('ABCDILOU')).toBeNull();
  });

  it('rejects wrong lengths', () => {
    expect(extractCode('ABC123')).toBeNull();
    expect(extractCode('ABCD12345')).toBeNull();
  });

  it('rejects unrelated QR payloads', () => {
    expect(extractCode('https://example.com')).toBeNull();
    expect(extractCode('')).toBeNull();
  });
});

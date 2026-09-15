/**
 * Pairing-code parsing. Pure, so it can be tested without React Native.
 *
 * The alphabet mirrors the server's (server/src/domain/pairing.ts): Crockford
 * style, omitting I, L, O and U so a code survives being read aloud over the
 * phone. Rejecting those characters here rather than at the server turns a
 * confusing round-trip failure into immediate local feedback.
 */

export const CODE_LENGTH = 8;
export const CODE_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** Typing helper: keeps the field to a valid partial code. */
export function normaliseInput(input: string): string {
  return input.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
}

/**
 * Accepts a bare code or a guardian://pair?code=XXXX style URL.
 *
 * Unlike the typing helper this never truncates: a nine-character payload is
 * a wrong payload, and quietly clipping it to eight would send a plausible
 * but incorrect code to the server.
 */
export function extractCode(scanned: string): string | null {
  const cleaned = scanned.trim().toUpperCase().replace(/[\s-]/g, '');
  if (CODE_PATTERN.test(cleaned)) return cleaned;

  const match = /CODE=([0-9A-Z]{8})(?:[^0-9A-Z]|$)/.exec(cleaned);
  if (match?.[1] && CODE_PATTERN.test(match[1])) return match[1];

  return null;
}

/**
 * WebRTC connection setup.
 *
 * The media path is deliberately peer-to-peer: the phone and the guardian's
 * browser talk directly, and the stream is encrypted end-to-end by DTLS-SRTP.
 * No server - including this one - ever holds the plaintext. That is what lets
 * the product claim the camera feed is private, and it is why an SFU was not
 * used: an SFU decrypts and re-encrypts every frame, so the claim would have
 * been false without a further insertable-streams layer on top.
 *
 * The cost of peer-to-peer is NAT traversal. Most connections succeed with
 * STUN alone; the rest need a TURN relay. TURN relays ciphertext it cannot
 * read, so the guarantee survives.
 *
 * Credentials here follow coturn's REST API scheme (a long-term-credential
 * variant): the username is an expiry timestamp joined to an identity, and the
 * password is an HMAC of that username under a shared secret. The TURN server
 * derives the same HMAC and never needs a user database, and a leaked
 * credential dies on its own within TURN_TTL_SECONDS.
 */

import { createHmac } from 'node:crypto';

export interface TurnCredentials {
  username: string;
  credential: string;
  /** Unix seconds after which the TURN server will reject these. */
  expiresAt: number;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * Deterministic given `nowMs`, so it is tested without a clock or a network.
 * `identity` is only an audit aid inside the username; it is not a secret and
 * must never be a token.
 */
export function makeTurnCredentials(
  secret: string,
  ttlSeconds: number,
  identity: string,
  nowMs: number,
): TurnCredentials {
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  // coturn splits on the FIRST colon, so an identity containing one would
  // shift the boundary and produce a username the server parses differently.
  const safeIdentity = identity.replace(/:/g, '_');
  const username = `${expiresAt}:${safeIdentity}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt };
}

/** Split a comma-separated URL list, tolerating stray whitespace and blanks. */
export function parseUrlList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface IceConfigInput {
  stunUrls: string;
  turnUrls: string;
  turnSecret: string;
  turnTtlSeconds: number;
  identity: string;
  nowMs: number;
}

/**
 * Build the ICE server list a peer should use.
 *
 * TURN is omitted entirely when unconfigured rather than emitted with empty
 * credentials: a browser given a TURN entry it cannot authenticate against
 * stalls in ICE gathering instead of falling back cleanly to STUN.
 */
export function buildIceServers(input: IceConfigInput): IceServer[] {
  const servers: IceServer[] = [];

  const stun = parseUrlList(input.stunUrls);
  if (stun.length > 0) servers.push({ urls: stun });

  const turn = parseUrlList(input.turnUrls);
  if (turn.length > 0 && input.turnSecret) {
    const { username, credential } = makeTurnCredentials(
      input.turnSecret,
      input.turnTtlSeconds,
      input.identity,
      input.nowMs,
    );
    servers.push({ urls: turn, username, credential });
  }

  return servers;
}

/** Channels that carry live media. Location is pushed over REST, not WebRTC. */
export type MediaChannel = 'CAMERA' | 'MICROPHONE';

export function isMediaChannel(value: unknown): value is MediaChannel {
  return value === 'CAMERA' || value === 'MICROPHONE';
}

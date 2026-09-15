import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildIceServers,
  isMediaChannel,
  makeTurnCredentials,
  parseUrlList,
} from '../src/domain/rtc.js';

const NOW = 1_700_000_000_000; // fixed clock

describe('makeTurnCredentials', () => {
  it('encodes the expiry in the username, as coturn expects', () => {
    const c = makeTurnCredentials('s3cret', 600, 'user-1', NOW);
    expect(c.expiresAt).toBe(1_700_000_000 + 600);
    expect(c.username).toBe(`${1_700_000_000 + 600}:user-1`);
  });

  it('produces an HMAC-SHA1 of the username the TURN server can re-derive', () => {
    const c = makeTurnCredentials('s3cret', 600, 'user-1', NOW);
    const expected = createHmac('sha1', 's3cret').update(c.username).digest('base64');
    expect(c.credential).toBe(expected);
  });

  it('never lets an identity introduce a second colon', () => {
    // coturn splits on the first colon; an identity containing one would move
    // the boundary and change how the server reads the expiry.
    const c = makeTurnCredentials('s3cret', 60, 'evil:identity', NOW);
    expect(c.username.split(':')).toHaveLength(2);
    expect(c.username.endsWith(':evil_identity')).toBe(true);
  });

  it('is deterministic for the same inputs and moves with the clock', () => {
    expect(makeTurnCredentials('s', 60, 'u', NOW)).toEqual(makeTurnCredentials('s', 60, 'u', NOW));
    expect(makeTurnCredentials('s', 60, 'u', NOW + 60_000).expiresAt).toBe(
      makeTurnCredentials('s', 60, 'u', NOW).expiresAt + 60,
    );
  });
});

describe('parseUrlList', () => {
  it('trims, and drops blanks from trailing commas', () => {
    expect(parseUrlList(' stun:a:3478 , turn:b:3478 ,, ')).toEqual(['stun:a:3478', 'turn:b:3478']);
    expect(parseUrlList('')).toEqual([]);
  });
});

describe('buildIceServers', () => {
  const base = {
    stunUrls: 'stun:stun.l.google.com:19302',
    turnUrls: 'turn:turn.example.org:3478',
    turnSecret: 'shared',
    turnTtlSeconds: 3600,
    identity: 'user-1',
    nowMs: NOW,
  };

  it('returns STUN and credentialled TURN when both are configured', () => {
    const servers = buildIceServers(base);
    expect(servers).toHaveLength(2);
    expect(servers[0]?.urls).toEqual(['stun:stun.l.google.com:19302']);
    expect(servers[0]?.username).toBeUndefined();
    expect(servers[1]?.username).toContain(':user-1');
    expect(servers[1]?.credential).toBeTruthy();
  });

  it('omits TURN entirely when no secret is set', () => {
    // Emitting a TURN entry with empty credentials makes browsers stall in ICE
    // gathering rather than fall back to STUN.
    const servers = buildIceServers({ ...base, turnSecret: '' });
    expect(servers).toHaveLength(1);
    expect(servers[0]?.urls[0]).toMatch(/^stun:/);
  });

  it('omits TURN when no URLs are set', () => {
    expect(buildIceServers({ ...base, turnUrls: '' })).toHaveLength(1);
  });

  it('returns an empty list when nothing is configured', () => {
    expect(buildIceServers({ ...base, stunUrls: '', turnUrls: '' })).toEqual([]);
  });
});

describe('isMediaChannel', () => {
  it('accepts only the two channels that carry media', () => {
    expect(isMediaChannel('CAMERA')).toBe(true);
    expect(isMediaChannel('MICROPHONE')).toBe(true);
    expect(isMediaChannel('LOCATION')).toBe(false);
    expect(isMediaChannel(undefined)).toBe(false);
  });
});

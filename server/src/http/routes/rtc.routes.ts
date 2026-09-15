import { Router } from 'express';
import { asyncHandler } from '../async.js';
import { requireAuth, currentUserId } from '../middleware/auth.js';
import { loadEnv } from '../../lib/env.js';
import { buildIceServers } from '../../domain/rtc.js';

export const rtcRoutes = Router();
rtcRoutes.use(requireAuth);

/**
 * ICE servers for a peer about to negotiate.
 *
 * Credentials are minted per request and short-lived, so a leaked response is
 * only useful until it expires. The TURN shared secret never leaves the server.
 */
rtcRoutes.get(
  '/rtc/ice',
  asyncHandler(async (req, res) => {
    const env = loadEnv();
    const iceServers = buildIceServers({
      stunUrls: env.STUN_URLS,
      turnUrls: env.TURN_URLS,
      turnSecret: env.TURN_SECRET,
      turnTtlSeconds: env.TURN_TTL_SECONDS,
      identity: currentUserId(req),
      nowMs: Date.now(),
    });

    res.json({
      iceServers,
      // Tells the client whether a relay is available at all, so it can warn
      // rather than silently fail on a restrictive network.
      turnConfigured: iceServers.some((s) => Boolean(s.username)),
    });
  }),
);

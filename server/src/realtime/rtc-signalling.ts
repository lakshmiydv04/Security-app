/**
 * WebRTC signalling relay.
 *
 * This server brokers the handshake and nothing else. Offers, answers and ICE
 * candidates pass through; media does not. Once the peers connect, the stream
 * flows phone-to-browser directly under DTLS-SRTP and no server holds the
 * plaintext - which is the whole reason a peer-to-peer design was chosen over
 * an SFU.
 *
 * Direction matters. The DEVICE offers, never the guardian. The device is the
 * side that owns the camera, so it is the side that decides when capture
 * begins - and it raises its indicator before it ever calls getUserMedia. A
 * guardian-initiated offer would invert that.
 */

import type { Server, Socket } from 'socket.io';
import { logger } from '../lib/logger.js';
import { requireParticipant } from '../http/guards.js';
import { resolvePrivacy } from '../domain/privacy-service.js';
import { isMediaChannel } from '../domain/rtc.js';
import { userRoom } from './rooms.js';

interface Envelope {
  pairingId?: string;
  sessionId?: string;
  kind?: string;
  sdp?: unknown;
  candidate?: unknown;
  reason?: string;
}

type Ack = ((r: unknown) => void) | undefined;

export function registerRtcHandlers(io: Server, socket: Socket, userId: string): void {
  /** The other party in the pairing - the only socket a relay may reach. */
  const counterpart = async (pairingId: string) => {
    const p = await requireParticipant(pairingId, userId);
    return {
      role: p.role,
      otherUserId: p.role === 'GUARDIAN' ? p.monitoredUserId : p.guardianId,
    };
  };

  /**
   * Device offers its stream. This is the gate: the privacy decision is made
   * here, at the one moment media is about to start, and resolvePrivacy writes
   * the audit row as a side effect.
   */
  socket.on('rtc:offer', async (raw: unknown, ack: Ack) => {
    const { pairingId, sessionId, kind, sdp } = (raw ?? {}) as Envelope;
    if (!pairingId || !sessionId || !sdp || !isMediaChannel(kind)) {
      ack?.({ ok: false, error: 'BAD_REQUEST' });
      return;
    }

    try {
      const { role, otherUserId } = await counterpart(pairingId);
      if (role !== 'MONITORED') {
        // Only the device offers. A guardian offering would mean the browser
        // decided when capture starts, which is exactly backwards.
        ack?.({ ok: false, error: 'DEVICE_ONLY' });
        return;
      }

      const decision = await resolvePrivacy(pairingId, kind, { userId, role: 'MONITORED' });
      if (!decision.allowed) {
        ack?.({ ok: false, error: decision.reason, message: decision.message });
        return;
      }

      io.to(userRoom(otherUserId)).emit('rtc:offer', { pairingId, sessionId, kind, sdp });
      ack?.({ ok: true });
    } catch (err) {
      logger.debug({ err }, 'rtc:offer rejected');
      ack?.({ ok: false, error: 'NOT_FOUND' });
    }
  });

  /** Guardian answers. No gate: the offer it answers was already gated. */
  socket.on('rtc:answer', async (raw: unknown, ack: Ack) => {
    const { pairingId, sessionId, sdp } = (raw ?? {}) as Envelope;
    if (!pairingId || !sessionId || !sdp) {
      ack?.({ ok: false, error: 'BAD_REQUEST' });
      return;
    }
    try {
      const { role, otherUserId } = await counterpart(pairingId);
      if (role !== 'GUARDIAN') {
        ack?.({ ok: false, error: 'GUARDIAN_ONLY' });
        return;
      }
      io.to(userRoom(otherUserId)).emit('rtc:answer', { pairingId, sessionId, sdp });
      ack?.({ ok: true });
    } catch (err) {
      logger.debug({ err }, 'rtc:answer rejected');
      ack?.({ ok: false, error: 'NOT_FOUND' });
    }
  });

  /**
   * ICE candidates, either direction.
   *
   * Deliberately NOT re-gated per candidate: a single negotiation emits dozens,
   * and running the privacy check on each would add a database read and an
   * audit row per candidate, burying the log that matters under handshake
   * noise. Participation is still verified. If permission is withdrawn
   * mid-call, `endCallsNoLongerPermitted` below tears the session down, which
   * is the check that actually protects the person.
   */
  socket.on('rtc:ice', async (raw: unknown) => {
    const { pairingId, sessionId, candidate } = (raw ?? {}) as Envelope;
    if (!pairingId || !sessionId || !candidate) return;
    try {
      const { otherUserId } = await counterpart(pairingId);
      io.to(userRoom(otherUserId)).emit('rtc:ice', { pairingId, sessionId, candidate });
    } catch {
      /* not a participant: drop silently */
    }
  });

  /** Either side hangs up. Always relayed, never gated - stopping is never refused. */
  socket.on('rtc:end', async (raw: unknown) => {
    const { pairingId, sessionId, reason } = (raw ?? {}) as Envelope;
    if (!pairingId || !sessionId) return;
    try {
      const { otherUserId } = await counterpart(pairingId);
      io.to(userRoom(otherUserId)).emit('rtc:end', {
        pairingId,
        sessionId,
        reason: reason ?? 'PEER_ENDED',
      });
    } catch {
      /* not a participant: drop silently */
    }
  });
}

/**
 * Tear down any live call on a pairing whose privacy state no longer allows it.
 *
 * Called whenever privacy changes. Broadcast to the whole pairing room on
 * purpose: both ends must stop, and the device must stop capturing even if the
 * guardian's browser ignores the message.
 */
export function endCallsNoLongerPermitted(
  io: Server,
  pairingId: string,
  snapshot: { cameraEnabled: boolean; microphoneEnabled: boolean; masterShieldActive: boolean; pairingStatus: string } | null,
): void {
  if (!snapshot) {
    io.to(`pairing:${pairingId}`).emit('rtc:end', { pairingId, reason: 'PAIRING_GONE' });
    return;
  }
  if (snapshot.pairingStatus !== 'ACTIVE') {
    io.to(`pairing:${pairingId}`).emit('rtc:end', { pairingId, reason: 'PAIRING_REVOKED' });
    return;
  }
  if (snapshot.masterShieldActive) {
    io.to(`pairing:${pairingId}`).emit('rtc:end', { pairingId, reason: 'SHIELD_RAISED' });
    return;
  }
  if (!snapshot.cameraEnabled) {
    io.to(`pairing:${pairingId}`).emit('rtc:end', { pairingId, kind: 'CAMERA', reason: 'CHANNEL_OFF' });
  }
  if (!snapshot.microphoneEnabled) {
    io.to(`pairing:${pairingId}`).emit('rtc:end', { pairingId, kind: 'MICROPHONE', reason: 'CHANNEL_OFF' });
  }
}

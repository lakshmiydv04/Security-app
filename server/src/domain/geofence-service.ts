/**
 * Database-backed geofence evaluation. The geometry and transition rules live
 * in geofence.ts and stay pure; this file is only the I/O around them.
 *
 * Transitions are derived from the last recorded event per zone rather than
 * from the previous ping, so a device that was offline for an hour still
 * produces exactly one ENTER when it reappears inside a zone - not a burst,
 * and not silence.
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '../lib/db.js';
import { decideTransition, haversineMeters } from './geofence.js';

export interface GeofenceHit {
  zoneId: string;
  zoneName: string;
  type: 'ENTER' | 'EXIT';
}

export async function evaluateGeofences(
  pairingId: string,
  lat: number,
  lng: number,
  client: PrismaClient = defaultClient,
): Promise<GeofenceHit[]> {
  const zones = await client.geofenceZone.findMany({
    where: { pairingId, active: true },
  });
  if (zones.length === 0) return [];

  const hits: GeofenceHit[] = [];

  for (const zone of zones) {
    const lastEvent = await client.geofenceEvent.findFirst({
      where: { zoneId: zone.id },
      orderBy: { occurredAt: 'desc' },
      select: { type: true },
    });

    const wasInside = lastEvent ? lastEvent.type === 'ENTER' : null;
    const distance = haversineMeters(lat, lng, zone.centerLat, zone.centerLng);
    const transition = decideTransition(zone, distance, wasInside);
    if (!transition) continue;

    await client.geofenceEvent.create({
      data: { zoneId: zone.id, pairingId, type: transition, lat, lng },
    });
    hits.push({ zoneId: zone.id, zoneName: zone.name, type: transition });
  }

  return hits;
}

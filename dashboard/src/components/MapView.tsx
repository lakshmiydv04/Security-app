'use client';

/**
 * Leaflet map. Imported with `ssr: false` by the page - Leaflet touches
 * `window` at module scope and will crash a server render.
 *
 * Uses CircleMarker rather than Marker on purpose: Leaflet's default marker
 * pulls PNG assets through the bundler and silently renders nothing when the
 * paths do not resolve. Vector shapes have no asset dependency at all.
 */

import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { FALLBACK_CENTER } from '@/lib/geo';
import { formatRelative } from '@/lib/format';
import type { GeofenceZone, LocationPing } from '@/lib/types';

interface DraftZone {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

export interface SosPoint {
  lat: number;
  lng: number;
  triggeredAt: string;
}

interface Props {
  position: LocationPing | null;
  sharingActive: boolean;
  zones: GeofenceZone[];
  draft: DraftZone | null;
  placing: boolean;
  onPlace: (lat: number, lng: number) => void;
  sos: SosPoint | null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }): null {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

function ClickCapture({ onPlace }: { onPlace: (lat: number, lng: number) => void }): null {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView({
  position,
  sharingActive,
  zones,
  draft,
  placing,
  onPlace,
  sos,
}: Props): React.JSX.Element {
  // An SOS outranks the usual position for centring: if someone has pressed
  // the panic button, that is where the guardian needs to be looking.
  const center: [number, number] = sos
    ? [sos.lat, sos.lng]
    : position
      ? [position.lat, position.lng]
      : draft
        ? [draft.centerLat, draft.centerLng]
        : FALLBACK_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={14}
      scrollWheelZoom
      className="h-[420px] w-full rounded-xl"
      style={{ cursor: placing ? 'crosshair' : undefined }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {placing && <ClickCapture onPlace={onPlace} />}
      {sos ? (
        <Recenter lat={sos.lat} lng={sos.lng} />
      ) : (
        position && <Recenter lat={position.lat} lng={position.lng} />
      )}

      {zones
        .filter((z) => z.active)
        .map((zone) => (
          <Circle
            key={zone.id}
            center={[zone.centerLat, zone.centerLng]}
            radius={zone.radiusMeters}
            pathOptions={{ color: '#5B8DEF', fillColor: '#5B8DEF', fillOpacity: 0.12 }}
          >
            <Popup>
              <strong>{zone.name}</strong>
              <br />
              {zone.radiusMeters} m radius
            </Popup>
          </Circle>
        ))}

      {draft && (
        <Circle
          center={[draft.centerLat, draft.centerLng]}
          radius={draft.radiusMeters}
          pathOptions={{
            color: '#3DDC97',
            fillColor: '#3DDC97',
            fillOpacity: 0.15,
            dashArray: '6 6',
          }}
        />
      )}

      {sos && (
        <>
          {/* Halo plus dot, so the SOS reads at any zoom level. */}
          <Circle
            center={[sos.lat, sos.lng]}
            radius={120}
            pathOptions={{ color: '#FF4D4F', fillColor: '#FF4D4F', fillOpacity: 0.25, weight: 3 }}
          />
          <CircleMarker
            center={[sos.lat, sos.lng]}
            radius={11}
            pathOptions={{ color: '#FFFFFF', fillColor: '#FF4D4F', fillOpacity: 1, weight: 3 }}
          >
            <Popup>
              <strong>SOS</strong>
              <br />
              {formatRelative(sos.triggeredAt)}
            </Popup>
          </CircleMarker>
        </>
      )}

      {position && (
        <CircleMarker
          center={[position.lat, position.lng]}
          radius={9}
          pathOptions={{
            // Grey when sharing has stopped: the dot is the last known point,
            // not a live one, and colouring it live would be a lie.
            color: sharingActive ? '#3DDC97' : '#9AA3B2',
            fillColor: sharingActive ? '#3DDC97' : '#9AA3B2',
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            {sharingActive ? 'Current location' : 'Last known location'}
            <br />
            {formatRelative(position.capturedAt)}
            {position.accuracyMeters != null && (
              <>
                <br />±{Math.round(position.accuracyMeters)} m
              </>
            )}
          </Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}

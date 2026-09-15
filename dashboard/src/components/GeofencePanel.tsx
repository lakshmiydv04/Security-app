'use client';

import { useCallback, useState } from 'react';
import { geofenceApi } from '@/lib/endpoints';
import { ApiError } from '@/lib/api';
import { clampRadius, formatDistance, MAX_RADIUS_M, MIN_RADIUS_M } from '@/lib/geo';
import type { GeofenceZone } from '@/lib/types';

interface DraftZone {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
}

interface Props {
  pairingId: string;
  zones: GeofenceZone[];
  draft: DraftZone | null;
  placing: boolean;
  onStartPlacing: () => void;
  onCancel: () => void;
  onDraftChange: (draft: DraftZone) => void;
  onSaved: () => void;
}

export function GeofencePanel({
  pairingId,
  zones,
  draft,
  placing,
  onStartPlacing,
  onCancel,
  onDraftChange,
  onSaved,
}: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [notifyOnEnter, setNotifyOnEnter] = useState(true);
  const [notifyOnExit, setNotifyOnExit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!draft || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await geofenceApi.create(pairingId, {
        name: name.trim(),
        centerLat: draft.centerLat,
        centerLng: draft.centerLng,
        radiusMeters: clampRadius(draft.radiusMeters),
        notifyOnEnter,
        notifyOnExit,
      });
      setName('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [draft, name, notifyOnEnter, notifyOnExit, pairingId, onSaved]);

  const remove = useCallback(
    async (zoneId: string) => {
      try {
        await geofenceApi.remove(pairingId, zoneId);
        onSaved();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      }
    },
    [pairingId, onSaved],
  );

  return (
    <section className="rounded-xl border border-line bg-ink-raised p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Safe zones</h2>
        {!placing && !draft && (
          <button
            onClick={onStartPlacing}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
          >
            Add a zone
          </button>
        )}
      </div>

      {placing && !draft && (
        <p className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          Click the map to place the centre of the zone.
        </p>
      )}

      {draft && (
        <div className="mt-4 space-y-3 rounded-lg border border-line p-4">
          <div>
            <label htmlFor="zone-name" className="mb-1 block text-sm text-muted">
              Zone name
            </label>
            <input
              id="zone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="School, home, work…"
              maxLength={60}
              className="w-full rounded-lg border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="zone-radius" className="mb-1 block text-sm text-muted">
              Radius: {formatDistance(draft.radiusMeters)}
            </label>
            <input
              id="zone-radius"
              type="range"
              min={MIN_RADIUS_M}
              max={5000}
              step={25}
              value={Math.min(draft.radiusMeters, 5000)}
              onChange={(e) => onDraftChange({ ...draft, radiusMeters: Number(e.target.value) })}
              className="w-full accent-shield"
              aria-valuetext={formatDistance(draft.radiusMeters)}
            />
            <p className="mt-1 text-xs text-muted">
              Between {formatDistance(MIN_RADIUS_M)} and {formatDistance(MAX_RADIUS_M)}.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifyOnEnter}
                onChange={(e) => setNotifyOnEnter(e.target.checked)}
                className="accent-accent"
              />
              Alert on arrival
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={notifyOnExit}
                onChange={(e) => setNotifyOnExit(e.target.checked)}
                className="accent-accent"
              />
              Alert on leaving
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void save()}
              disabled={busy || !name.trim()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save zone'}
            </button>
            <button onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-live">
          {error}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {zones.length === 0 && !draft && (
          <li className="text-sm text-muted">No safe zones yet.</li>
        )}
        {zones.map((zone) => (
          <li
            key={zone.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
          >
            <div>
              <p className="font-medium">{zone.name}</p>
              <p className="text-xs text-muted">
                {formatDistance(zone.radiusMeters)} radius ·{' '}
                {zone.notifyOnEnter && zone.notifyOnExit
                  ? 'arrival and leaving'
                  : zone.notifyOnEnter
                    ? 'arrival only'
                    : zone.notifyOnExit
                      ? 'leaving only'
                      : 'no alerts'}
              </p>
            </div>
            <button
              onClick={() => void remove(zone.id)}
              className="text-sm text-live hover:underline"
              aria-label={`Delete safe zone ${zone.name}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

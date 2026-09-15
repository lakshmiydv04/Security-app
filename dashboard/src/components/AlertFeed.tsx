'use client';

/**
 * Geofence arrivals and departures, newest first. SOS events appear in the
 * activity log; this feed is the movement history a guardian scans quickly.
 */

import { formatRelative, formatTime } from '@/lib/format';
import type { GeofenceEvent } from '@/lib/types';

export function AlertFeed({ events }: { events: GeofenceEvent[] }): React.JSX.Element {
  return (
    <section className="rounded-xl border border-line bg-ink-raised p-5">
      <h2 className="text-lg font-semibold">Zone activity</h2>

      {events.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No arrivals or departures recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {events.slice(0, 25).map((event) => (
            <li
              key={event.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"
            >
              <span>
                <span
                  className={event.type === 'ENTER' ? 'text-shield' : 'text-locked'}
                >
                  {event.type === 'ENTER' ? 'Arrived at' : 'Left'}
                </span>{' '}
                <strong>{event.zone.name}</strong>
              </span>
              <time dateTime={event.occurredAt} title={formatTime(event.occurredAt)} className="text-muted">
                {formatRelative(event.occurredAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

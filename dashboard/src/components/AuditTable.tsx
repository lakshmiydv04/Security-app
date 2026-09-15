'use client';

/**
 * The audit trail.
 *
 * Two things this deliberately does not offer: a way to hide a category of
 * event, and a way to edit one. The log is shown identically to both parties,
 * and the server rejects mutation at the database level - so the honest thing
 * for the UI is to make the totals visible even while a search narrows the
 * rows on screen.
 */

import { useMemo, useState } from 'react';
import {
  actionLabel,
  countEvents,
  EMPTY_FILTER,
  filterEvents,
  reasonLabel,
  type OutcomeFilter,
} from '@/lib/audit';
import { formatTime, CHANNEL_LABELS } from '@/lib/format';
import type { AuditEvent, ChainVerification } from '@/lib/types';

const OUTCOME_STYLES: Record<string, string> = {
  ALLOWED: 'text-shield',
  DENIED: 'text-locked',
  INFO: 'text-muted',
};

const OUTCOMES: OutcomeFilter[] = ['ALL', 'ALLOWED', 'DENIED', 'INFO'];

interface Props {
  events: AuditEvent[];
  verification: ChainVerification | null;
  loading: boolean;
}

export function AuditTable({ events, verification, loading }: Props): React.JSX.Element {
  const [query, setQuery] = useState(EMPTY_FILTER.query);
  const [outcome, setOutcome] = useState<OutcomeFilter>(EMPTY_FILTER.outcome);

  const filtered = useMemo(
    () => filterEvents(events, { query, outcome }),
    [events, query, outcome],
  );
  const counts = useMemo(() => countEvents(events), [events]);

  return (
    <section className="rounded-xl border border-line bg-ink-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Activity log</h2>
          <p className="mt-1 text-sm text-muted">
            Append-only and hash-chained. The person you are connected to sees exactly this.
          </p>
        </div>

        {verification && (
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              verification.valid
                ? 'border-shield/40 bg-shield/10 text-shield'
                : 'border-live/40 bg-live/10 text-live'
            }`}
          >
            {verification.valid
              ? `Chain verified · ${verification.length} entries`
              : `Chain broken at #${verification.brokenAtSeq} (${verification.problem})`}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="audit-search" className="sr-only">
            Search the activity log
          </label>
          <input
            id="audit-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — try “denied camera”"
            className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="flex gap-1" role="group" aria-label="Filter by outcome">
          {OUTCOMES.map((o) => (
            <button
              key={o}
              onClick={() => setOutcome(o)}
              aria-pressed={outcome === o}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                outcome === o ? 'border-accent bg-accent/15 text-body' : 'border-line text-muted'
              }`}
            >
              {o === 'ALL' ? `All ${counts.total}` : `${o[0]}${o.slice(1).toLowerCase()}`}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-muted" aria-live="polite">
        Showing {filtered.length} of {counts.total} · {counts.denied} denied · {counts.allowed}{' '}
        allowed
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">
            Audit events, most recent first. Includes toggle changes, sensor access checks and
            SOS events.
          </caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                #
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                When
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Event
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Channel
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                By
              </th>
              <th scope="col" className="py-2 font-medium">
                Outcome
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  {counts.total === 0 ? 'Nothing recorded yet.' : 'No entries match that search.'}
                </td>
              </tr>
            )}

            {filtered.map((event) => {
              const reason = reasonLabel(event);
              return (
                <tr key={event.seq} className="border-b border-line/60 align-top">
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{event.seq}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-muted">
                    {formatTime(event.occurredAt)}
                  </td>
                  <td className="py-2 pr-3">
                    {actionLabel(event)}
                    {reason && <span className="block text-xs text-muted">{reason}</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {event.channel ? CHANNEL_LABELS[event.channel] : '—'}
                  </td>
                  <td className="py-2 pr-3 text-muted">
                    {event.actorRole === 'MONITORED'
                      ? 'Them'
                      : event.actorRole === 'GUARDIAN'
                        ? 'You'
                        : 'System'}
                  </td>
                  <td className={`py-2 font-medium ${OUTCOME_STYLES[event.outcome] ?? ''}`}>
                    {event.outcome[0]}
                    {event.outcome.slice(1).toLowerCase()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

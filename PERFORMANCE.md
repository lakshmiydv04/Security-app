# Guardian — performance: what's actually slow, and the fixes

Diagnosed against the real code (`server/`, `dashboard/`, `mobile/`), not generic tips.
A couple of items from the generic plan don't apply to your setup — noted below so you
don't spend time on them or run a command that hurts.

---

## The #1 cause of "slow after clicking" on BOTH platforms: the Render backend

Your mobile app and dashboard are both thin clients of
`https://guardian-backend-z16n.onrender.com`. Almost every click → an API or socket
call to that server. So if the server is slow to answer, *everything* feels slow on
*both* platforms at once — which is exactly your symptom.

On Render's free/hobby tier the service **spins down after ~15 min idle**. The next
request pays a **30–60s cold start** while it boots, plus Prisma reconnects to Postgres
on the first query. That reads as "I clicked and nothing happened for a minute."

**Fixes, in order of impact:**

1. **Upgrade Render to a tier that doesn't sleep** (Starter, ~$7/mo). This is the real
   fix — it removes cold starts entirely. For a safety product where a parent may open
   the dashboard once a day, an always-warm backend isn't optional.
2. **Stopgap if you must stay on free:** an external uptime pinger
   (UptimeRobot, cron-job.org) hitting `GET /health` every ~10 min to keep it awake.
   Honest caveats: it must be *external* (a self-ping can't wake a sleeping instance),
   and keeping one free service always-on burns roughly the whole monthly free-hours
   allowance — so this is a band-aid, not a substitute for (1).
3. **Confirm the DB pooler flags** your schema comments already describe:
   `DATABASE_URL` on the transaction pooler with `?pgbouncer=true`, `DIRECT_URL` on 5432
   for migrations. A misconfigured pooler shows up as intermittent latency spikes.

---

## Two code fixes I already applied

### 1. Refresh storm on socket (re)connect — dashboard + mobile

`useLiveConnections` (dashboard) and `App.tsx` (mobile) both call a full refresh from
`onConnectionChange` on *every* socket connect, and again from their mount effect. A
full refresh is `1 + 2N` requests (`/api/pairings`, then `privacy.get` + `subscribe`
per pairing). On a flaky mobile link the socket reconnects repeatedly, and each
reconnect fired another full storm — at a possibly-cold Render instance. That compounds
into a UI that sits spinning.

**Fix (applied):** an in-flight guard so overlapping refreshes share one run instead of
duplicating. It still fetches current data — it just stops the stampede. Files:
`dashboard/src/hooks/useLiveConnections.ts`, `mobile/src/App.tsx`.

> I deliberately did **not** add caching of privacy snapshots. Your code treats the
> server snapshot as the single source of truth and drops stale ones on purpose
> (the "UI must not lie about consent" invariant). Caching those would trade a real
> safety guarantee for a little speed — not worth it.

---

## Things from the generic plan that DON'T apply to you (skip these)

- **"Add DB indexes."** Already done. `LocationPing` has `@@index([pairingId, capturedAt])`,
  `AuditEvent` has `@@index([pairingId, seq])`, `GeofenceEvent` has
  `@@index([pairingId, occurredAt])`, `Pairing` has `@@index([monitoredUserId])`. Your
  hot queries are already covered.
- **`npx prisma db push` — do NOT run this.** Your project uses **migrations**
  (`prisma migrate deploy`) with the pooler/`directUrl` split. `db push` bypasses
  migration history and, per your own schema comment, taking a schema lock through the
  transaction pooler *hangs*. If you ever add an index, do it with
  `prisma migrate dev` locally / `migrate deploy` on Render, over `DIRECT_URL`.
- **"Throttle GPS to 10–15s / 30–60s."** Your ping interval is already 60s
  (`LOCATION_PING_INTERVAL_MS`). It isn't flooding anything.
- **"Throttle map marker updates to 1–2s."** Your position path polls every 30s and the
  socket only carries privacy/indicator state, not a 60fps GPS stream — there's nothing
  to throttle here yet. (If you later add live streaming coordinates, *then* throttle
  the marker with `requestAnimationFrame`.)

---

## Worth doing next (I can implement on request)

1. **Lift `useLiveConnections` into a context provider** (in `layout.tsx` / `AppShell`).
   Right now navigating list → detail unmounts the hook, tears down the socket, and
   re-runs the full refresh on the new page. One shared provider = one socket, no
   refetch-on-navigation. Medium-sized change; biggest front-end win after the Render fix.
2. **Collapse the N+1 on the backend:** have `GET /api/pairings` return each pairing's
   privacy snapshot inline, so the dashboard/app stop making `privacy.get` per pairing.
   Turns `1 + 2N` requests into `1 + N` (just the socket subscribes).
3. **Always test the mobile app on a Release build.** The Metro dev bundle runs ~5×
   slower than release; some of the "stutter" is dev-mode only. Confirm on
   `app-release.apk` before optimizing further.
4. **Dashboard prod build.** `reactStrictMode: true` double-invokes effects in *dev*
   only (looks like double-fetching). Measure on `next build && next start`, not `dev`.

---

*Net: the backend is the dominant lever — fix Render first and both platforms will feel
dramatically snappier. The two code fixes remove the self-inflicted request storms on
top of that.*


---

# Verification (added after the first run-through)

## One command instead of the manual checklist

```powershell
cd D:\down\app\server
npm run dev                 # in one terminal
npm run verify:security     # in another
```

`scripts/verify-security.mjs` drives the real API and the real database and
prints a pass/fail line per check:

- `UPDATE` / `DELETE` / `TRUNCATE` on `audit_events` are each rejected
- the hash chain verifies
- nothing is shared before the guardian confirms the pairing
- a camera request **forced through the API** is refused when the switch is
  off — this is the important one, because it bypasses the dashboard's
  disabled button and tests the server, not the UI
- the refusal is recorded in the audit log
- the master Privacy Shield overrides an ON switch
- **SOS still succeeds with the Shield up**
- the monitored user can revoke unilaterally, and revocation outranks
  everything else

It creates two throwaway accounts and deletes them afterwards. Their audit
rows remain — the log is append-only, and a verification that could erase its
own tracks would disprove the thing it is checking.

Exit code is non-zero if any check fails, so it can go in CI later.

## Corrections to the checklist

**"row-level security rules should throw an error"** — there is no RLS here.
Immutability comes from two different mechanisms: `BEFORE UPDATE/DELETE/TRUNCATE`
triggers, plus `REVOKE UPDATE, DELETE, TRUNCATE` from the application role
(skipped while `APP_DB_ROLE` is empty). The hash chain is a third layer that
makes tampering *detectable*. Worth naming precisely, because "RLS" describes
something the database is not doing.

**`NEXT_PUBLIC_API_URL` is the wrong variable name.** The dashboard reads
`NEXT_PUBLIC_GUARDIAN_API_URL`. Setting the wrong one appears to work only
because the fallback happens to be `http://localhost:4000` — it would break
the moment the backend moved.

**Do not set `"@react-native-community/cli": "latest"`.** Latest is 20.x, which
targets React Native 0.81+; this project is on 0.76.5 and needs CLI 15.x. It is
already pinned to `^15.0.1`, along with the matching
`cli-platform-android` / `cli-platform-ios`.

**SOS now does what the checklist expects — it did not before.** Previously an
SOS was recorded in the database and the audit log, but nothing reached an open
dashboard. Added:

- the server emits `sos:alert` to the pairing room *and* the guardian's own
  room, immediately after the rows are committed (never before — a guardian
  must not see an alert that is not also on the record), fire-and-forget so a
  socket problem cannot fail the request
- the dashboard shows a pinned red banner with coordinates and elapsed time,
  on both the connections list and the detail page
- the map drops a red halo marker at the SOS location and recentres on it,
  outranking the normal position
- **Acknowledge** calls the API and emits `sos:acknowledged` back to the
  phone — the most reassuring thing the system can say in return

There is no auto-hide timer. An alert that disappears while someone is out of
the room has failed.

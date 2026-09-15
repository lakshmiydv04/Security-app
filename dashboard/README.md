# Guardian Dashboard

The guardian's web interface: Next.js (App Router) + TypeScript + Tailwind,
with Leaflet for mapping. Talks to `../server`.

## Setup

```bash
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_GUARDIAN_API_URL
npm run dev
```

Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Read this before deploying: token storage

The access token is held in memory only. **The refresh token goes to
`localStorage`, which any XSS on this origin can read.** That is not a good
place for it; it is the only place available, because the backend returns
tokens in the response body rather than setting cookies.

The fix is a backend change, not a frontend one: have `/api/auth/login`,
`/register` and `/refresh` set the refresh token as an `httpOnly`, `Secure`,
`SameSite=Strict` cookie and stop returning it in the body, then delete the
`localStorage` branch in `src/lib/api.ts`. Until that happens this dashboard
should not be considered production-ready, regardless of how finished it
looks. It is called out here rather than left as a silent default.

Concurrent 401s already share a single refresh promise — the backend treats a
replayed refresh token as theft and revokes the whole family, so parallel
rotations would sign the guardian out.

## Dependency versions

Scaffolded on Next 14.2.21, which `npm audit` immediately flagged with two
**critical** CVEs (dev-server origin verification, image-optimizer cache key
confusion), plus criticals in `vitest` and highs in the `postcss`/`glob`
chain. Shipping known criticals in a product whose whole premise is privacy
was not defensible, so the stack moved to current majors:

- Next **16.3.4**, React **19**, react-leaflet **5** (v4 does not support React 19)
- ESLint **9** with flat config — `eslint-config-next@16` requires it, and ships
  native flat config, so it is imported directly rather than through
  `FlatCompat` (which crashes on a circular plugin reference)
- vitest **5**

`npm audit` now reports 0 vulnerabilities. React 19's stricter
`react-hooks/set-state-in-effect` rule caught two genuine cascading-render
patterns in the process; both were restructured rather than suppressed.

**The build passes and every route compiles, but nothing here has been opened
in a browser.** Verify the map interaction and the pairing QR render before
trusting the UI.

## How the four pieces work

**Auth & pairing** — `/sign-in`, then `/connections`. The pairing generator
shows the 8-character code as text and as a QR (`guardian://pair?code=…`),
with a live expiry countdown. It also surfaces the step the blueprint left
out: after the other person redeems the code, **the guardian must confirm the
specific person** before anything is shared. Without that panel a guardian
reads out a code and then watches nothing happen.

**Live map & geofences** — Leaflet + OpenStreetMap, no API key. Loaded via
`dynamic(..., { ssr: false })` because Leaflet touches `window` at module
scope. Uses `CircleMarker`/`Circle` rather than `Marker`: Leaflet's default
marker pulls PNG assets through the bundler and silently renders nothing when
those paths do not resolve. Click the map to place a safe zone, drag the
radius slider, save. **When sharing is off the position dot turns grey and the
header says so** — it is the last known point, not a live one, and colouring
it live would be a lie.

**Sensor panel** — status cards derived from the server snapshot via
`channelStatus`, which mirrors `server/src/domain/privacy.ts` including the
precedence order (inactive beats lock, lock beats shield). Request buttons
enable from that snapshot, never from local optimism, so the moment the
monitored person flips a switch the socket delivers `privacy:state` and the
button disables itself. That is the blueprint's state-synchronisation problem,
solved in the place it actually bites.

A refusal renders as a calm status, not an error: "Privacy Shield is on" is
the system working correctly, and dressing it up as a failure teaches
guardians to read consent as a fault.

**Audit log** — searchable and filterable over the hash-chained trail, with
the chain-verification badge from `GET /api/audit/verify`. Multi-term search
narrows (every term must match) rather than widening. There is deliberately no
control that hides a category of event, and the unfiltered totals stay on
screen while a search is active — the log is shown identically to both parties
and a "hide denials" filter would quietly break that.

## The mirroring risk

`src/lib/channel-status.ts` reimplements the server's privacy precedence in
the browser. That is a duplicate of a security-relevant rule, and duplicates
drift. It is tested against the same cases as the server's own suite, but if
you change `evaluatePrivacy` on the backend, change this too — otherwise the
dashboard starts offering buttons the server will refuse.

The duplication is deliberate: the alternative is a round trip before every
render, and the server still enforces regardless of what this file says. It is
a UX mirror, never the gate.

## Not built yet

- **Media playback.** `POST /api/pairings/:id/sensor-sessions` returns
  `mediaToken: null` by design — a request is not a grant, and the SFU mints
  the token only after re-checking the gate. Wiring the LiveKit/MediaSoup
  viewer is the remaining piece.
- **SOS push.** SOS events appear in the activity log; there is no toast or
  desktop notification when one arrives while the dashboard is open.
- **Pagination.** The audit table loads the most recent 200 entries; the
  backend's `before` cursor is not wired up.

# Guardian Server

API, signalling and consent enforcement for the family safety platform.

This is the first slice: **backend + data model**. The guardian dashboard
(Next.js) and the monitored-device app (React Native) are not built yet, and
should be built against the contracts here rather than alongside them - the
enforcement model has to be settled before anything depends on it.

## The three guarantees

Everything else in this codebase is negotiable. These are not:

**1. Privacy state is enforced on the server.**
The blueprint originally put the check in the mobile app's local state
controller. That is not a security boundary - a repackaged build removes it and
the guardian keeps streaming. `src/domain/privacy.ts` holds the single decision
point; `resolvePrivacy()` is called by every command route, every location push
and every media-token path. The device toggle remains as the user's control
surface and a latency optimisation, not as the enforcement.

**2. Either party can end a connection, unilaterally and instantly.**
`revokePairing()` deliberately checks only "are you one of these two people".
Revocation outranks every other rule, including a guardian channel lock. This
is the escape hatch that keeps the guardian-managed tier from being an abuse
vector; if it ever grows a further permission check, the product has changed
character.

**3. The indicator and the audit log have no suppression path.**
Not by policy - by omission. There is no column, flag or parameter anywhere
that hides an active stream or removes an audit row. Denials are logged with
the same weight as grants, because a refused access attempt is exactly what a
monitored user most wants to be able to see later.

## The tier decision

The hardest call in the product is who holds the kill switch when the monitored
person is a young child. If the child can always disable everything, the
product does not do what guardians will buy it for - so there is standing
commercial pressure to add "guardian can lock the toggle", and that single
feature is what converts a safety app into stalkerware.

Resolution, encoded in `PairingTier`:

| | `SELF_MANAGED` (default) | `GUARDIAN_MANAGED` |
|---|---|---|
| Per-channel toggles | user only | user, except locked channels |
| Master kill switch | absolute | absolute except locked channels |
| Guardian channel locks | rejected | permitted |
| **Unilateral revocation** | **always** | **always** |
| Indicator + audit | non-suppressible | non-suppressible |

Entering `GUARDIAN_MANAGED` requires the monitored user's own action
(`setTier` refuses the guardian), and stepping back down to `SELF_MANAGED` is
always available to them and clears any locks.

`tests/privacy.test.ts` pins all of this, including an exhaustive sweep of the
state space. The assertion that revocation outranks a guardian lock is the most
important line in the suite.

## Setup

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and the two JWT secrets
npm run prisma:generate
npm run prisma:migrate        # first run creates the schema
npm run db:harden             # applies the append-only guarantees - see below
npm run dev
```

Then: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

### `db:harden` is not optional

"Append-only" as a naming convention is worth nothing if the app's database
role can still `UPDATE` or `DELETE`. `npm run db:harden` applies:

- `prisma/sql/001_audit_immutability.sql` - `BEFORE UPDATE / DELETE / TRUNCATE`
  triggers that raise. Covers owner and superuser connections that privilege
  grants miss. `TRUNCATE` is handled separately because it bypasses row-level
  triggers.
- `prisma/sql/002_audit_grants.sql` - `REVOKE UPDATE, DELETE, TRUNCATE` from the
  application role. Skipped with a warning unless `APP_DB_ROLE` is set; on a
  single-role dev database it is a no-op and the trigger carries the guarantee
  alone.

The hash chain in `src/domain/audit.ts` is the third layer: it makes tampering
that defeats both of the above *detectable*. `GET /api/audit/verify` walks it.

## Two things to fix before you ship

**"E2EE" and "SFU" contradict each other.** SRTP is hop-by-hop. Put an SFU
(LiveKit, MediaSoup) in the path and it decrypts and re-encrypts - the server
*can* see the media. Real end-to-end encryption through an SFU needs insertable
streams / SFrame layered on top. Either implement that or drop the phrase from
the marketing copy; it is the kind of claim that draws regulatory attention
when it turns out to have meant TLS.

**Lean on the OS indicators, not your own banner.** An app-drawn "glowing
banner" can be removed by a modified build, so it cannot be the guarantee. iOS
and Android both enforce their own camera and microphone indicators - treat
those as the real promise and the in-app banner as an addition. Do not request
any permission that would suppress them. `command:sensor` carries
`requiresIndicator: true` for the in-app half; the OS half is not ours to
control, which is the point.

## Notes

- `REDIS_URL` is optional. Without it, presence is an in-process `Map`: correct
  for one instance, wrong the moment you run two. It warns at startup in
  production.
- `mediaToken` is returned as `null` by design. A request is not a grant - the
  media service mints the token only after independently re-checking the gate.
- Refresh tokens are stored as SHA-256 hashes and rotate in families; replaying
  a rotated token revokes the whole family.
- Location pings carry `expiresAt` from `LOCATION_RETENTION_DAYS`. The sweeper
  job is not written yet.

## Layout

```
src/domain/       privacy.ts + privacy-service.ts   <- enforcement
                  audit.ts + audit-writer.ts        <- hash chain / persistence
                  geofence.ts + geofence-service.ts <- geometry / persistence
                  pairing.ts, tokens.ts
src/http/         routes, guards, middleware
src/realtime/     Socket.io signalling
prisma/           schema + the hardening SQL
tests/            pure-function suites, no database required
```

The `x.ts` / `x-service.ts` split is deliberate throughout: the rules stay pure
and exhaustively testable, the I/O sits beside them. Tests run with no database
and no network.

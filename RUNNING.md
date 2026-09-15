# Running the Guardian system

Three processes, started in this order: **Postgres → server → dashboard →
(optional) mobile app**. The dashboard and the mobile app are both clients of
the server; neither does anything useful until the server can reach the
database.

---

## 0. One-time fix: a stray `DATABASE_URL`

`npm run db:harden` failed with *"Can't reach database server at
`postgres:5432`"* even though `.env` correctly says `localhost:5432`.

That is not a typo in your file. **dotenv never overwrites a variable that is
already set in the environment**, so a `DATABASE_URL` left over in Windows (or
in that PowerShell session) silently wins over the file. Prisma then reports a
hostname that appears nowhere in your project, which is why it looked
inexplicable.

Find it:

```powershell
$env:DATABASE_URL
[Environment]::GetEnvironmentVariable("DATABASE_URL", "User")
[Environment]::GetEnvironmentVariable("DATABASE_URL", "Machine")
```

Clear whichever one is set:

```powershell
$env:DATABASE_URL = $null                                              # this window
[Environment]::SetEnvironmentVariable("DATABASE_URL", $null, "User")   # persisted
```

Then **open a new terminal** so the change takes effect.

The server now detects this case itself: if `.env` disagrees with what is
actually in effect, startup stops with both values printed (password redacted)
and the exact command to clear it, instead of a confusing connection error.

---

## 1. Postgres

Make sure the `postgresql-x64-*` service is running in Windows Services, and
that the database exists:

```powershell
psql -U postgres -c "CREATE DATABASE guardian_db;"    # once; ignore "already exists"
```

## 2. Server — `D:\down\app\server`

```powershell
npm install
npm run prisma:generate
npm run prisma:migrate       # creates the schema; name it "init"
npm run db:harden            # REQUIRED - see below
npm run dev                  # http://localhost:4000
```

**`db:harden` is not optional.** Until it runs, `audit_events` is append-only
in name only — the triggers that block `UPDATE`, `DELETE` and `TRUNCATE` do not
exist yet, and the hash chain only makes tampering *detectable*, not
impossible. It will warn that it skipped the privilege half because
`APP_DB_ROLE` is empty; that is expected for a local single-role setup, and the
trigger carries the guarantee on its own. For production, create a non-owner
application role and set `APP_DB_ROLE` to it.

Health check: `curl http://localhost:4000/health` → `{"status":"ok"}`

## 3. Dashboard — `D:\down\app\dashboard`

```powershell
npm install
npm run dev                  # http://localhost:3000
```

Set `NEXT_PUBLIC_GUARDIAN_API_URL=http://localhost:4000` in `.env.local` if it
is not already there.

> The "slow filesystem" warning from Next is because the project is on `D:`.
> Harmless; it only affects rebuild speed.

## 4. Mobile app — `D:\down\app\mobile`

```powershell
npm run bootstrap            # RE-RUN THIS - see below
npm install
npm run android              # needs an emulator running or a device attached
```

**Re-run `bootstrap`.** The previous run left the Android project incomplete:
`MainApplication.kt` and `MainActivity.kt` were never placed, and without them
Gradle cannot build anything. The script now locates those two files
explicitly, registers the foreground-service package in them, and **verifies
the project is complete before exiting** — so if it prints "Verified: Android
project is complete", it is.

`npx react-native run-android` also failed with a message about
`@react-native-community/cli`. React Native 0.76 no longer bundles the CLI; it
is now in `devDependencies`, so `npm run android` works after `npm install`.

### Pointing the phone at your server

`localhost` on a phone means *the phone*. The app defaults to `10.0.2.2`, which
is how the **Android emulator** reaches your PC. On a **real device** on your
wifi, set this in `mobile/.env`:

```
GUARDIAN_API_URL=http://192.168.0.211:4000
```

(that was your machine's LAN address in the Next.js output — re-check it with
`ipconfig` if it has changed). The phone and the PC must be on the same
network, and Windows Firewall must allow inbound 4000.

---

## How the two people actually use it

The system deliberately needs **both** people to act. There is no way to set it
up from one side, which is what separates it from stalkerware.

**Guardian, on the dashboard**

1. Sign in at `http://localhost:3000` → redirected to **Connections**.
2. Click **Generate code**. An 8-character code and a QR appear, valid for 10
   minutes.
3. Give the code to the other person — read it aloud, or let them scan the QR.
4. Wait. Nothing is shared yet.

**Loved one, on the phone**

5. Create an account and sign in.
6. On the pairing screen, read what the connection actually grants — it is
   stated plainly, including the right to end it unilaterally — then type the
   code or scan the QR.
7. That puts the connection in **PENDING**. Still nothing shared.

**Guardian again**

8. A *"Waiting for your confirmation"* panel appears on the dashboard, naming
   who redeemed the code. **Confirm** (or Reject).
9. Only now does the connection become **ACTIVE**. Location defaults to on;
   camera and microphone default to **off**.

**Day to day**

- The phone pushes a location ping every 60 seconds while location sharing is
  on. The dashboard map shows the position; when sharing is off the dot turns
  **grey** and the header says so — it is the last known point, not a live one.
- The guardian draws safe zones by clicking the map and dragging the radius
  slider. Arrivals and departures appear in **Zone activity**.
- To ask for a camera or mic check-in, the guardian clicks **Request
  check-in**. That button is enabled from the *server's* view of the phone's
  switches, so the moment the loved one flips one off the button disables
  itself within a second.
- The loved one can hit **Privacy Shield** to cut everything off instantly, or
  flip individual channels. Requests made while it is on are refused by the
  server and shown as *"Privacy Shield is on"* — a normal status, not an error.
- **SOS** works even with the shield up. That is deliberate and must stay that
  way.
- Either side can end the connection at any time, without the other's
  approval.
- Both sides see the **same** activity log, including refused requests.

---

## What does not work yet

- **Media playback.** Requesting a check-in raises the indicator on the phone,
  notifies the dashboard, and records the request in the audit log — but no
  audio or video is transmitted. The server returns `mediaToken: null` by
  design (a request is not a grant), and the WebRTC/LiveKit layer that would
  mint a real token and carry the stream is not built. This is the largest
  remaining piece.
- **Push notifications.** If the dashboard is closed, an SOS is recorded but
  nothing pings the guardian.
- **iOS.** The project is generated but has never been built; it needs a Mac
  with Xcode and `pod install`.

## Known dependency advisories

| Project | Status |
|---|---|
| dashboard | 0 vulnerabilities |
| server | 3 high, all in Prisma's own CLI chain (`prisma` → `@prisma/config` → `deepmerge-ts`) |
| mobile | 14 (7 high, 7 moderate), all in React Native's Metro bundler chain |

Neither remaining set is fixable right now, and both are **build-time tooling,
not shipped code**:

- The Prisma advisory covers `6.13.0` through `8.1.0-dev`. The latest *stable*
  Prisma (7.10.0) is still inside that range, so there is no released version
  to upgrade to. Triggering it needs an attacker-controlled Prisma config file.
- The Metro advisories resolve only by upgrading React Native 0.76 → 0.87,
  eleven minor versions, which changes Gradle, AGP and Kotlin expectations and
  can break the native module. Worth doing deliberately, with an emulator in
  front of you — not blind.

The criticals that *were* present (vitest in both projects) are fixed.

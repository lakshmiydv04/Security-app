# Persistence wiring — the one manual edit + how to verify

Most of this is already on disk:

- `AndroidManifest.xml` — `RECEIVE_BOOT_COMPLETED` + the `GuardianBootReceiver` registration. ✅
- `app/build.gradle` — `androidx.work:work-runtime-ktx:2.9.1`. ✅
- `service/GuardianServiceState.kt` — persisted "protection enabled" flag + start/schedule/cancel helpers. ✅ (new)
- `service/GuardianBootReceiver.kt` — restarts the service after reboot / app update. ✅ (new)
- `service/GuardianRestartWorker.kt` — 15-min watchdog that restarts the service if the OS killed it. ✅ (new)

Only **`GuardianForegroundService.kt`** needs your hand — it sits too deep for the file
bridge to read, so I can't merge into it blind. Three small touches:

### 1. Return `START_STICKY` and arm persistence when the service starts

In `onStartCommand(...)`, after your existing `startForeground(...)`:

```kotlin
override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // ... your existing channel setup + startForeground(NOTIFICATION_ID, buildNotification(state)) ...

    // Remember that protection is meant to be running, and arm the watchdog, so
    // a kill or reboot can bring the service back under its visible notification.
    GuardianServiceState.setProtectionEnabled(this, true)
    GuardianServiceState.scheduleWatchdog(this)

    // Optional: cache the token JS passed, for the connection-lost beacon.
    intent?.getStringExtra("com.guardianmobile.ACCESS_TOKEN")
        ?.let { GuardianServiceState.setAccessToken(this, it) }

    // If the OS kills us, recreate the service. intent is null on that restart,
    // so read your state from the persisted flag / SharedPreferences, not intent.
    return START_STICKY
}
```

### 2. Clear persistence when the user turns protection OFF

Wherever you stop the service on the master toggle going off (your `stop()` / the
`GuardianServiceModule.stop` path that calls `stopForeground` + `stopSelf`):

```kotlin
GuardianServiceState.setProtectionEnabled(this, false)
GuardianServiceState.cancelWatchdog(this)
// ... then your existing stopForeground(STOP_FOREGROUND_REMOVE) + stopSelf() ...
```

This is what makes the toggle authoritative: once it's off, neither the boot receiver
nor the watchdog will ever start the service again.

### 3. (If you added the token beacon earlier) read the token via `GuardianServiceState.accessToken(this)`

Replaces the standalone SharedPreferences helper from the earlier connection-lost patch,
so there's one source of truth.

---

## Reliability — the honest picture

This setup covers the common cases well, but "unkillable" isn't a real thing on Android,
and it's worth knowing where the edges are:

- **OS memory kill →** `START_STICKY` restarts the service automatically. ✅
- **Reboot / app update →** `GuardianBootReceiver` restarts it. ✅ **Caveat (Android 14+):**
  starting a *location-typed* foreground service straight from `BOOT_COMPLETED` can be
  refused by the OS. The helper swallows that refusal instead of crashing; the watchdog
  and the next app-open recover it. If you need location the instant after a reboot on
  Android 14, that's a deeper piece (a `specialUse`/`dataSync`-typed bootstrap) — tell me
  and I'll wire it.
- **OEM battery killers (Xiaomi, Oppo, Vivo, Samsung, etc.) →** these aggressively kill
  background services regardless of `START_STICKY`, and they're the #1 real-world reason
  safety apps "stop working." The single most effective fix is to ask the user to exempt
  the app from battery optimization — send them to
  `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (or the OEM's auto-start screen)
  from your onboarding. That one prompt does more for reliability than any code here.
  Life360 and every serious tracker do exactly this. I can add that flow if you want.

None of this changes the disclosure model: every restart re-posts the visible
notification, camera/mic stay on-demand with the OS indicators, and the master toggle
stops everything.

## Verify

1. Enable protection → confirm the notification, and that location reaches the dashboard.
2. Swipe the app off recents → notification stays, location keeps flowing (`START_STICKY`).
3. From a terminal: `adb shell am force-stop com.guardianmobile`, wait ≤15 min → the
   watchdog restarts the service (watch `adb logcat` / the dashboard flips back online).
4. Reboot the device → on Android ≤13 the service returns automatically; on 14+ open the
   app once if the boot-start was refused (see caveat).
5. Turn the master toggle OFF → confirm the service stops and does **not** come back after
   a force-stop (the flag is cleared).

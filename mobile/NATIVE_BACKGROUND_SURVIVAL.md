# Native step (manual): make the foreground service survive task removal

Everything else in this fix is already applied to disk. This one file —
`android/app/src/main/java/com/guardianmobile/service/GuardianForegroundService.kt` —
sits too deep for the file bridge to read or write automatically, so it is the
**only** change you apply by hand. Paste the members below into your existing
`GuardianForegroundService` class (don't replace the file — you already have
notification/channel setup there worth keeping).

> **You may not even need the beacon for correctness.** The server now flags a
> device offline on its own the moment the socket drops
> (`server/src/realtime/io.ts`), which fires when the process is force-stopped,
> loses signal, or dies. The native beacon below is a latency + labelling
> optimisation: it reaches the guardian a few seconds sooner and says *why*
> ("app dismissed" vs a generic drop). `START_STICKY` + not-stopping-on-task-
> removal is the part that actually keeps monitoring alive.

## 1. Return START_STICKY and handle task removal

```kotlin
override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Cache the token JS handed us (see step 3) so the beacon can authenticate
    // even after JS is gone. Survives a START_STICKY restart via SharedPreferences.
    intent?.getStringExtra(EXTRA_ACCESS_TOKEN)?.let { cacheAccessToken(it) }

    // ... your existing startForeground(NOTIFICATION_ID, buildNotification(state)) ...

    // If the OS kills us for memory, recreate the service. intent is null on
    // that restart, which is why the token is cached rather than only read here.
    return START_STICKY
}

/**
 * User swiped the app off the recents list.
 * We do NOT stopSelf — keeping monitoring alive when the app is dismissed is
 * the whole point. Fire a labelled beacon so the dashboard can say "app closed"
 * instead of waiting for the socket to time out.
 */
override fun onTaskRemoved(rootIntent: Intent?) {
    fireConnectionLostBeacon("TASK_REMOVED")
    // Do NOT relaunch the Activity here — a covert relaunch is exactly what this
    // product refuses to do. Just keep the service running.
}

override fun onDestroy() {
    fireConnectionLostBeacon("SERVICE_DESTROYED")
    super.onDestroy()
}
```

## 2. The beacon (native OkHttp, so it runs while the process is dying)

```kotlin
companion object {
    const val EXTRA_ACCESS_TOKEN = "com.guardianmobile.ACCESS_TOKEN"
    private const val PREFS = "guardian_service"
    private const val KEY_TOKEN = "access_token"
    // Must match config.ts PRODUCTION_API_URL.
    private const val API_BASE = "https://guardian-backend-z16n.onrender.com"
}

private fun cacheAccessToken(token: String) {
    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_TOKEN, token).apply()
}

private fun readAccessToken(): String? =
    getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_TOKEN, null)

private fun fireConnectionLostBeacon(reason: String) {
    val token = readAccessToken() ?: return
    val body = """{"reason":"$reason"}"""
        .toRequestBody("application/json".toMediaType())
    val req = Request.Builder()
        .url("$API_BASE/api/device/connection-lost")
        .header("Authorization", "Bearer $token")
        .post(body)
        .build()

    // The process may be moments from death, so we cannot wait on the main
    // thread and cannot use a long timeout.
    Thread {
        try {
            OkHttpClient.Builder()
                .callTimeout(3, java.util.concurrent.TimeUnit.SECONDS)
                .build()
                .newCall(req).execute().close()
        } catch (_: Exception) { /* best effort */ }
    }.start()
}
```

Imports:

```kotlin
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
```

OkHttp is already on the React Native classpath; if the import doesn't resolve,
add `implementation("com.squareup.okhttp3:okhttp:4.12.0")` to
`android/app/build.gradle`.

## 3. Hand the token to the service (two small edits, same package)

The beacon needs a valid access token but must not read Keychain natively. The
simplest wiring: when JS starts the service, pass the current token as an intent
extra, which step 1 caches.

- In **`GuardianServiceModule.kt`** (`start`/`update` bridge methods), read a
  `token` field off the `ServiceState` map and put it on the Intent:

  ```kotlin
  val intent = Intent(reactContext, GuardianForegroundService::class.java)
  state.getString("accessToken")?.let {
      intent.putExtra(GuardianForegroundService.EXTRA_ACCESS_TOKEN, it)
  }
  ContextCompat.startForegroundService(reactContext, intent)
  ```

- In **`src/native/ForegroundService.ts`**, add `accessToken?: string` to
  `ServiceState`, and in **`src/realtime/indicatorSync.ts`**'s `derive()` include
  the current token, e.g. `accessToken: getState().auth.tokens?.accessToken`.
  (Refreshing it on every `update()` keeps the cached token from going stale
  after a rotation.)

## Verify

1. Sign in, enable sharing, confirm the "Guardian Safety Active" notification.
2. Swipe the app off recents. The notification stays; location keeps arriving on
   the dashboard; the audit log shows a `DEVICE_OFFLINE reason=TASK_REMOVED`
   only if you fully kill it — while the service lives, it stays online.
3. Force-stop the app from Settings. Within ~30s the dashboard flips the device
   offline from the socket drop alone (no beacon needed), with a matching
   `DEVICE_OFFLINE` audit row.

---

*If you'd rather I produce the finished `GuardianForegroundService.kt` (and the
two edits in step 3) merged into your exact current files, paste them here — or
copy the `service` folder up one level temporarily so the bridge can reach it —
and I'll hand them back complete.*

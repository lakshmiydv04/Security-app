package com.guardianmobile.service

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Shared, process-wide truth for whether Guardian protection should be running,
 * plus the helpers that (re)start the DISCLOSED foreground service.
 *
 * Everything here is about the disclosed service only: the persistent "Guardian
 * Safety Active" notification, location, and the command socket. Nothing here
 * captures the camera or microphone - those stay on-demand and indicator-gated,
 * started live from the dashboard, exactly as before.
 *
 * The "protection enabled" flag mirrors the user's master safety toggle. It is
 * persisted so the boot receiver and the WorkManager watchdog can decide, with
 * no JS running, whether the service is meant to be up - and so they NEVER start
 * it when the user has switched protection off.
 */
object GuardianServiceState {
    private const val PREFS = "guardian_service"
    private const val KEY_ENABLED = "protection_enabled"
    private const val KEY_TOKEN = "access_token"
    private const val WATCHDOG_WORK = "guardian-service-watchdog"

    fun setProtectionEnabled(context: Context, enabled: Boolean) {
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, enabled)
            .apply()
    }

    fun isProtectionEnabled(context: Context): Boolean =
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, false)

    /**
     * Cache the access token so the service's connection-lost beacon (and any
     * other native call) can authenticate even after JS is gone. Optional -
     * safe to leave unused if the beacon is not wired.
     */
    fun setAccessToken(context: Context, token: String?) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (token == null) prefs.edit().remove(KEY_TOKEN).apply()
        else prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    fun accessToken(context: Context): String? =
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TOKEN, null)

    /**
     * Start the foreground service if protection is enabled. Returns true if a
     * start was attempted.
     *
     * On Android 12+ a start from the background can be refused with
     * ForegroundServiceStartNotAllowedException - most notably a location-typed
     * FGS started straight from a reboot. We swallow that rather than crash: the
     * watchdog and START_STICKY retry from an allowed moment, and the user
     * reopening the app always succeeds. The service posts its disclosure
     * notification the instant it does start.
     */
    fun startServiceIfEnabled(context: Context): Boolean {
        if (!isProtectionEnabled(context)) return false
        val app = context.applicationContext
        val intent = Intent(app, GuardianForegroundService::class.java)
        return try {
            ContextCompat.startForegroundService(app, intent)
            true
        } catch (t: Throwable) {
            false
        }
    }

    /**
     * Schedule the periodic health-check that restarts the service if the OS has
     * killed it. 15 minutes is the WorkManager floor. KEEP so relaunching the
     * app never stacks duplicate schedules.
     */
    fun scheduleWatchdog(context: Context) {
        val work = PeriodicWorkRequestBuilder<GuardianRestartWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniquePeriodicWork(WATCHDOG_WORK, ExistingPeriodicWorkPolicy.KEEP, work)
    }

    fun cancelWatchdog(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(WATCHDOG_WORK)
    }
}

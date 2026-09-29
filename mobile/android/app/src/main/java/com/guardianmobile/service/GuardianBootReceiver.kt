package com.guardianmobile.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts the DISCLOSED foreground service after a device reboot or an app
 * update, but only when the user left protection enabled (the master toggle).
 *
 * It starts nothing silently: the service posts its ongoing "Guardian Safety
 * Active" notification on start, and camera/mic remain on-demand and
 * indicator-gated. If protection was off, this does nothing.
 */
class GuardianBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> {
                if (GuardianServiceState.isProtectionEnabled(context)) {
                    // A reboot clears WorkManager's periodic schedule on some
                    // OEMs, so re-arm the watchdog before trying to start.
                    GuardianServiceState.scheduleWatchdog(context)
                    GuardianServiceState.startServiceIfEnabled(context)
                }
            }
        }
    }
}

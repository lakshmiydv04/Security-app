package com.guardianmobile.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the app alive for command delivery, and discloses what is running.
 *
 * Two jobs, and the second is the important one. Android will kill a
 * backgrounded process aggressively, so a foreground service is the only
 * supported way to hold a socket open - but the price Android charges for
 * that is a visible, persistent notification, and here that price is the
 * point rather than a cost.
 *
 * Honest limitation: since Android 13 a user CAN swipe away a foreground
 * service notification (the service keeps running). So this notification is
 * persistent, not strictly unhideable. The guarantee that a modified build
 * cannot remove is the OS-drawn camera and microphone indicator in the status
 * bar, which is why the app must never request a permission that suppresses
 * it. This notification and the in-app banner are additions to that, not
 * substitutes for it.
 */
class GuardianForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "guardian_activity"
        const val NOTIFICATION_ID = 4711

        const val EXTRA_LOCATION = "sharingLocation"
        const val EXTRA_CAMERA = "cameraLive"
        const val EXTRA_MICROPHONE = "microphoneLive"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private var sharingLocation = false
    private var cameraLive = false
    private var microphoneLive = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        sharingLocation = intent?.getBooleanExtra(EXTRA_LOCATION, false) ?: false
        cameraLive = intent?.getBooleanExtra(EXTRA_CAMERA, false) ?: false
        microphoneLive = intent?.getBooleanExtra(EXTRA_MICROPHONE, false) ?: false

        startInForeground()
        isRunning = true

        // Restart if the system kills us: a monitored device that quietly
        // stops responding is worse than one that visibly reconnects.
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Safety sharing",
            // DEFAULT rather than LOW: this notification is a disclosure, and
            // a disclosure the user has to go looking for is not one.
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Shows when location, camera or microphone are being shared."
            setShowBadge(true)
            enableVibration(false)
            setSound(null, null)
        }

        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun title(): String = when {
        cameraLive && microphoneLive -> "Camera and microphone are live"
        cameraLive -> "Camera is live"
        microphoneLive -> "Microphone is live"
        sharingLocation -> "Sharing your location"
        else -> "Safety sharing is on"
    }

    private fun body(): String = when {
        cameraLive || microphoneLive -> "Your guardian can see or hear this right now."
        sharingLocation -> "Your guardian can see where you are. Tap to change this."
        else -> "Tap to review what is being shared."
    }

    private fun buildNotification(): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

        val contentIntent = launch?.let {
            PendingIntent.getActivity(this, 0, it, pendingFlags)
        }

        val streaming = cameraLive || microphoneLive

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title())
            .setContentText(body())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body()))
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(if (streaming) NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_SERVICE)
            .setPriority(if (streaming) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setColor(if (streaming) 0xFFFF4D4F.toInt() else 0xFF5B8DEF.toInt())
            .setColorized(streaming)
            // Visible on the lock screen: a stream that is only disclosed
            // after unlocking is not disclosed.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .apply { contentIntent?.let { setContentIntent(it) } }
            .build()
    }

    /**
     * Android 14 requires the declared foreground service types to match what
     * the service is actually doing, and throws if a type is claimed without
     * its permission. Types are computed from live state for that reason.
     */
    private fun foregroundTypes(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0

        var types = 0
        if (sharingLocation) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (cameraLive) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            if (microphoneLive) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        // Never zero on Q+: startForeground rejects an empty type set.
        if (types == 0) types = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        return types
    }

    private fun startInForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, foregroundTypes())
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }
}

internal fun Context.guardianServiceIntent(
    sharingLocation: Boolean,
    cameraLive: Boolean,
    microphoneLive: Boolean,
): Intent = Intent(this, GuardianForegroundService::class.java).apply {
    putExtra(GuardianForegroundService.EXTRA_LOCATION, sharingLocation)
    putExtra(GuardianForegroundService.EXTRA_CAMERA, cameraLive)
    putExtra(GuardianForegroundService.EXTRA_MICROPHONE, microphoneLive)
}

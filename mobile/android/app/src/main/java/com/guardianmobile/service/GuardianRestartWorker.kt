package com.guardianmobile.service

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Periodic health-check for the DISCLOSED foreground service.
 *
 * If protection is enabled but the OS has killed the service (memory pressure,
 * an aggressive OEM battery manager, a task-swipe on some devices), this brings
 * it back - under the same visible notification. If protection is off, it does
 * nothing.
 *
 * It never touches the camera or microphone. Its only job is to keep the
 * location/heartbeat service alive so the dashboard can reach the device; a
 * camera/mic check-in is still a separate, live, indicator-gated action the
 * parent triggers from the dashboard.
 */
class GuardianRestartWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (GuardianServiceState.isProtectionEnabled(applicationContext)) {
            GuardianServiceState.startServiceIfEnabled(applicationContext)
        }
        return Result.success()
    }
}

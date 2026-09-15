package com.guardianmobile.service

import android.content.Context
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/**
 * JS bridge for the foreground service.
 *
 * Note what is absent: there is no method to hide the notification, suppress
 * the OS indicators, or run the service without a notification. That is not
 * an oversight - a bridge that offers those is a bridge a future change will
 * eventually call.
 */
class GuardianServiceModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "GuardianForegroundService"

    private fun ReadableMap.boolOr(key: String, fallback: Boolean = false): Boolean =
        if (hasKey(key)) getBoolean(key) else fallback

    private fun launch(state: ReadableMap, promise: Promise) {
        try {
            val intent = reactContext.guardianServiceIntent(
                sharingLocation = state.boolOr("sharingLocation"),
                cameraLive = state.boolOr("cameraLive"),
                microphoneLive = state.boolOr("microphoneLive"),
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(reactContext, intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(null)
        } catch (e: Exception) {
            // Surfaced rather than swallowed: if the service cannot start, the
            // app is running without its disclosure and that must be visible.
            promise.reject("FOREGROUND_SERVICE_START_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun start(state: ReadableMap, promise: Promise) = launch(state, promise)

    /** Same intent path: onStartCommand refreshes the existing notification. */
    @ReactMethod
    fun update(state: ReadableMap, promise: Promise) = launch(state, promise)

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            reactContext.stopService(
                reactContext.guardianServiceIntent(
                    sharingLocation = false,
                    cameraLive = false,
                    microphoneLive = false,
                ),
            )
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("FOREGROUND_SERVICE_STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isRunning(promise: Promise) {
        promise.resolve(GuardianForegroundService.isRunning)
    }

    @Suppress("unused")
    private fun context(): Context = reactContext
}

package com.iris.calls

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the process alive and the mic/camera usable while a call is running with
 * the app in the background. Declares phoneCall always, plus microphone/camera
 * when those runtime permissions are granted (Android 14 refuses a type whose
 * permission is missing).
 */
class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    val peer = intent?.getStringExtra(EXTRA_PEER) ?: "Iris call"
    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    val notification = CallNotifier.ongoing(this, peer, video)
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (video && granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    try {
      ServiceCompat.startForeground(this, CallNotifier.ONGOING_ID, notification, types)
    } catch (e: Exception) {
      // Not allowed to start with these types right now (e.g. started from the background): retry plainly.
      try {
        ServiceCompat.startForeground(this, CallNotifier.ONGOING_ID, notification,
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL else 0)
      } catch (_: Exception) {
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

  companion object {
    const val ACTION_STOP = "com.iris.calls.STOP"
    const val EXTRA_PEER = "peer"
    const val EXTRA_VIDEO = "video"

    fun start(ctx: Context, peer: String, video: Boolean): Boolean = try {
      ContextCompat.startForegroundService(
        ctx, Intent(ctx, CallForegroundService::class.java).putExtra(EXTRA_PEER, peer).putExtra(EXTRA_VIDEO, video),
      )
      true
    } catch (_: Exception) {
      false
    }

    fun stop(ctx: Context) {
      try { ctx.startService(Intent(ctx, CallForegroundService::class.java).setAction(ACTION_STOP)) } catch (_: Exception) {}
    }
  }
}

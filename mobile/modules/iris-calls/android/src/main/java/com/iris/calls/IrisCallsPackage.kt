package com.iris.calls

import android.app.Activity
import android.app.AppOpsManager
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.util.Rational
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Picture-in-picture settings shared between the module and the activity hooks. */
object PipState {
  /** Armed only during an active video call (JS: src/calls/controls.ts pipWanted). */
  @Volatile var enabled = false
  @Volatile var aspect = Rational(9, 16)
  /** Set by IrisCallsModule while JS is up; receives MainActivity's PiP mode changes. */
  @Volatile var listener: ((Boolean) -> Unit)? = null

  fun params(): PictureInPictureParams {
    val b = PictureInPictureParams.Builder().setAspectRatio(aspect)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Android 12+: the system enters PiP itself on the home gesture, but only while armed.
      b.setAutoEnterEnabled(enabled).setSeamlessResizeEnabled(true)
    }
    return b.build()
  }

  /** Called from MainActivity.onPictureInPictureModeChanged (plugins/withPipModeCallback.js). */
  @JvmStatic
  fun changed(inPip: Boolean) {
    listener?.invoke(inPip)
  }

  /** The device has PiP and the user has not switched it off for Iris in system settings. */
  fun allowed(activity: Activity): Boolean {
    if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false
    val ops = activity.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return true
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), activity.packageName)
    } else {
      @Suppress("DEPRECATION")
      ops.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), activity.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }
}

/**
 * Activity hooks that cannot be expressed in the module DSL:
 *  - a launch from the call UI (full-screen intent / Answer) must show over the
 *    lock screen, and has to be decided in onCreate, before the window shows;
 *  - pre-Android-12 PiP entry on the home gesture.
 */
class IrisCallsPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(object : ReactActivityLifecycleListener {
      override fun onCreate(activity: Activity, savedInstanceState: Bundle?) = showOverLockscreenIfCall(activity, activity.intent)

      override fun onNewIntent(intent: Intent): Boolean = false

      // Re-assert the PiP params whenever the app comes back: a call that ended while the activity was away can
      // never leave auto-enter armed, so going home outside a call never shrinks the app into a PiP window.
      override fun onResume(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          try { activity.setPictureInPictureParams(PipState.params()) } catch (_: IllegalStateException) {}
        }
      }

      override fun onUserLeaveHint(activity: Activity) {
        if (PipState.enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
          try { activity.enterPictureInPictureMode(PipState.params()) } catch (_: IllegalStateException) {}
        }
      }
    })

  companion object {
    fun showOverLockscreenIfCall(activity: Activity, intent: Intent?) {
      if (intent?.getBooleanExtra(CallExtras.FLAG, false) == true) setShowOverLockscreen(activity, true)
    }

    fun setShowOverLockscreen(activity: Activity, on: Boolean) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(on)
        activity.setTurnScreenOn(on)
      } else {
        @Suppress("DEPRECATION")
        val f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        if (on) activity.window.addFlags(f) else activity.window.clearFlags(f)
      }
    }
  }
}

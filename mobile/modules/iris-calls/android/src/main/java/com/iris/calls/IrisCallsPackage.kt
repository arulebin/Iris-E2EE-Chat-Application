package com.iris.calls

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Picture-in-picture settings shared between the module and the activity hooks. */
object PipState {
  @Volatile var enabled = false
  @Volatile var aspect = Rational(9, 16)

  fun params(): PictureInPictureParams {
    val b = PictureInPictureParams.Builder().setAspectRatio(aspect)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Android 12+: the system enters PiP itself on the home gesture.
      b.setAutoEnterEnabled(enabled).setSeamlessResizeEnabled(true)
    }
    return b.build()
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

package expo.modules.irisscreensecurity

import android.app.Activity
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * FLAG_SECURE on the app window: blocks screenshots / screen recording and blanks
 * the recents tile. ON by default (applied whenever an activity enters the
 * foreground, so it holds across activity recreation); JS can toggle it for the
 * rare screen that must be shareable. Reference counting, if any, lives in JS.
 */
class IrisScreenSecurityModule : Module() {
  @Volatile private var secure = true

  override fun definition() = ModuleDefinition {
    Name("IrisScreenSecurity")

    OnActivityEntersForeground { apply(appContext.currentActivity) }

    AsyncFunction("setSecure") { enabled: Boolean ->
      secure = enabled
      val activity = appContext.currentActivity
      activity?.runOnUiThread { apply(activity) }
    }

    Function("isSecure") { secure }
  }

  private fun apply(activity: Activity?) {
    activity ?: return
    activity.runOnUiThread {
      if (secure) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}

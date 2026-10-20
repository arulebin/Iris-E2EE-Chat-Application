package com.iris.notify

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Runs the JS task "IrisMessage" (registered in mobile/index.js) without UI: for data pushes and for the
 * Reply / Mark-as-read notification actions. When the app is alive the task runs in the existing JS runtime
 * (same stores, same Signal client, same lock); when it was killed, the React host is started headless.
 */
class IrisMessageTaskService : HeadlessJsTaskService() {
  private val pushIds = CopyOnWriteArraySet<String>()

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    extras.getString("pushId")?.let { pushIds.add(it) }
    return HeadlessJsTaskConfig(
      TASK_NAME,
      Arguments.fromBundle(extras),
      TIMEOUT_MS,
      true, // also while the app is in the foreground (another chat open)
    )
  }

  override fun onDestroy() {
    MessagePush.flushUnhandled(applicationContext, pushIds)
    pushIds.clear()
    super.onDestroy()
  }

  companion object {
    const val TASK_NAME = "IrisMessage"
    private const val TIMEOUT_MS = 50_000L
  }
}

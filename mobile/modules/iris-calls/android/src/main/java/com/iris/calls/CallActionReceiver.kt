package com.iris.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** "Hang up" on the ongoing-call notification. (Answer/Decline use activities: Android 12 forbids trampolines.) */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_HANGUP) {
      CallBridge.action("hangup", null)
      // If JS is not running there is nothing to tell the peer; just drop the service so we stop recording.
      if (CallBridge.sink == null) {
        CallForegroundService.stop(context)
        CallAudio.stop(context)
        CallTelecom.endAll()
      }
    }
  }

  companion object {
    const val ACTION_HANGUP = "com.iris.calls.HANGUP"
  }
}

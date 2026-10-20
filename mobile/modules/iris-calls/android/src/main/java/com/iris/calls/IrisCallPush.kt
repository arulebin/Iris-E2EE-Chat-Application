package com.iris.calls

import android.content.Context

/**
 * Entry point for the push layer. The app's FirebaseMessagingService (owned by
 * the platform/push code) calls this from onMessageReceived for data messages of
 * `type == "incoming-call"`, with NO JS running:
 *
 *   if (IrisCallPush.handle(applicationContext, message.data)) return
 *
 * It starts the Telecom ring (system UI / lock screen) with a plain high-priority
 * full-screen notification as fallback, and starts the native ringtone. When the
 * user answers, MainActivity launches, JS mounts, connects the chat socket and the
 * relay replays the held offer (see docs/mobile-calls.md).
 */
object IrisCallPush {
  /** Returns true when the message was an incoming-call push and has been handled. */
  @JvmStatic
  fun handle(context: Context, data: Map<String, String>): Boolean {
    when (data["type"]) {
      "incoming-call" -> {
        val callId = data["callId"] ?: return false
        // The privacy-preserving payload carries no caller: ring as "Iris" and learn the name from the held offer.
        val from = data["from"] ?: ""
        val name = data["name"] ?: (if (from.isNotEmpty()) from else "Iris")
        val video = data["mode"] == "video"
        CallNotifier.ensureChannels(context)
        // Telecom shows the notification through onShowIncomingCallUi; fall back to posting it ourselves.
        if (!CallTelecom.addIncoming(context, callId, from, name, video)) {
          CallNotifier.showIncoming(context, callId, from, name, video)
        }
        return true
      }
      "call-cancelled" -> {
        CallNotifier.cancelIncoming(context, data["callId"])
        data["callId"]?.let { CallTelecom.end(it) }
        return true
      }
    }
    return false
  }
}

package com.iris.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import com.facebook.react.HeadlessJsTaskService

/**
 * Reply / Mark-as-read from a message notification. The work (encrypt + send through the normal send path,
 * read receipt) is JS, so this hands it to [IrisMessageTaskService]; tapping a notification action puts the
 * app on the temporary allowlist, so the service may start from the background.
 */
class MessageActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val chatId = intent.getStringExtra(MessageNotifier.EXTRA_CHAT) ?: return
    val kind = when (intent.action) {
      MessageNotifier.ACTION_REPLY -> "reply"
      MessageNotifier.ACTION_READ -> "read"
      else -> return
    }
    val text = if (kind == "reply") {
      RemoteInput.getResultsFromIntent(intent)?.getCharSequence(MessageNotifier.KEY_REPLY)?.toString()?.trim()
    } else null
    if (kind == "reply" && text.isNullOrEmpty()) return
    if (kind == "read") MessageNotifier.cancelConversation(context, chatId) // instant feedback; JS sends the receipt
    try {
      val svc = Intent(context, IrisMessageTaskService::class.java)
        .putExtra("kind", kind)
        .putExtra("chatId", chatId)
      if (text != null) svc.putExtra("text", text)
      HeadlessJsTaskService.acquireWakeLockNow(context)
      context.startService(svc)
    } catch (e: Exception) {
      Log.w("IrisMsgAction", "could not start the action task", e)
      if (kind == "reply") MessageNotifier.markReplyFailed(context, chatId)
    }
  }
}

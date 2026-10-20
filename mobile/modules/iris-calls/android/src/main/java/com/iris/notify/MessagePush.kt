package com.iris.notify

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Data-only message pushes (`msg`, `msg-wake`, `friend-request`, `friend-accepted`). The payload is ciphertext
 * plus opaque ids, so the work (fetch metadata, decrypt with the Signal session, store, notify) happens in JS:
 * this starts [IrisMessageTaskService], a HeadlessJsTaskService, which boots the JS runtime if the app was
 * killed or reuses the running one.
 *
 * Safety net: every push is tracked until JS reports it handled ([handled]). If JS never does (crash, timeout,
 * service could not start) a generic "New message" notification is posted instead, so a message is never silent.
 * The envelope itself stays queued on the server until the app acks it, so nothing is lost either way.
 */
object MessagePush {
  private const val TAG = "IrisMsgPush"
  val TYPES = setOf("msg", "msg-wake", "friend-request", "friend-accepted")

  /** pushId -> fallback kind ("message" | "request"), until JS marks it handled. */
  private val pending = ConcurrentHashMap<String, String>()

  @JvmStatic
  fun handle(context: Context, data: Map<String, String>): Boolean {
    val type = data["type"] ?: return false
    if (type !in TYPES) return false
    val ctx = context.applicationContext
    val pushId = UUID.randomUUID().toString()
    val fallback = if (type.startsWith("friend-")) "request" else "message"
    pending[pushId] = fallback
    try {
      val intent = Intent(ctx, IrisMessageTaskService::class.java)
        .putExtra("kind", "push")
        .putExtra("pushId", pushId)
      for ((k, v) in data) if (k in PUSH_FIELDS) intent.putExtra(k, v)
      HeadlessJsTaskService.acquireWakeLockNow(ctx)
      // Allowed from the background: a high-priority FCM message puts the app on the temporary allowlist.
      ctx.startService(intent)
    } catch (e: Exception) {
      Log.w(TAG, "could not start the message task; showing a generic notification", e)
      pending.remove(pushId)
      MessageNotifier.showGeneric(ctx, fallback)
    }
    return true
  }

  /** FCM dropped messages (device offline too long): treat like a wake-up so pending envelopes get fetched. */
  @JvmStatic
  fun onDeleted(context: Context) {
    handle(context, mapOf("type" to "msg-wake"))
  }

  fun handled(pushId: String) {
    pending.remove(pushId)
  }

  /** Called when the task service goes away: anything JS did not handle gets the generic notification. */
  fun flushUnhandled(context: Context, ids: Collection<String>) {
    for (id in ids) {
      val kind = pending.remove(id) ?: continue
      Log.w(TAG, "push $id not handled by JS; generic notification")
      MessageNotifier.showGeneric(context, kind)
    }
  }

  private val PUSH_FIELDS = setOf("type", "mid", "eid", "et", "env")
}

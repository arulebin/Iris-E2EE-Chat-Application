package com.iris.notify

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Data-only message pushes (`msg`, `msg-wake`, `friend-request`, `friend-accepted`). The payload is ciphertext
 * plus opaque ids, so the work (fetch metadata, decrypt with the Signal session, store, notify) happens in JS,
 * in the task "IrisMessage" (mobile/index.js):
 *
 *  - App process alive (foreground, or in recents — possibly frozen by Android until this push woke it): the
 *    task is started directly in the running React context, and [handle] (called from
 *    FirebaseMessagingService.onMessageReceived, off the main thread) waits for JS to finish. While it waits
 *    the FCM service keeps the process running and awake, so Android cannot freeze it again mid-decrypt, and no
 *    background service has to be started (OEM ROMs such as MIUI/HyperOS/ColorOS may silently refuse that).
 *  - No process / no React context (swiped away, killed): [IrisMessageTaskService], a HeadlessJsTaskService,
 *    boots the JS runtime headless.
 *
 * Safety net: every push is tracked until JS reports it handled ([handled]). If JS never does (crash, timeout,
 * service could not start) a generic "New message" notification is posted instead, so a message is never silent.
 * The envelope itself stays queued on the server until the app acks it, so nothing is lost either way.
 */
object MessagePush {
  private const val TAG = "IrisMsgPush"
  val TYPES = setOf("msg", "msg-wake", "friend-request", "friend-accepted")

  /** How long onMessageReceived waits for JS (FCM gives a high-priority message about 10 s of execution). */
  private const val INLINE_WAIT_MS = 9_000L
  /** After that, how long JS still has before the generic fallback is posted. */
  private const val WATCHDOG_MS = 45_000L

  /** pushId -> fallback kind ("message" | "request"), until JS marks it handled. */
  private val pending = ConcurrentHashMap<String, String>()
  private val waiters = ConcurrentHashMap<String, CountDownLatch>()
  private val main by lazy { Handler(Looper.getMainLooper()) }

  @JvmStatic
  fun handle(context: Context, data: Map<String, String>): Boolean {
    val type = data["type"] ?: return false
    if (type !in TYPES) return false
    val ctx = context.applicationContext
    val pushId = UUID.randomUUID().toString()
    val fallback = if (type.startsWith("friend-")) "request" else "message"
    pending[pushId] = fallback
    val extras = Bundle().apply {
      putString("kind", "push")
      putString("pushId", pushId)
      for ((k, v) in data) if (k in PUSH_FIELDS) putString(k, v)
    }
    if (runInProcess(ctx, pushId, extras)) return true
    try {
      val intent = Intent(ctx, IrisMessageTaskService::class.java).putExtras(extras)
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

  /** The app's JS runtime, when this process already has one running. */
  private fun liveReactContext(ctx: Context): ReactContext? = try {
    (ctx as? ReactApplication)?.reactHost?.currentReactContext?.takeIf { it.hasActiveReactInstance() }
  } catch (e: Exception) {
    null
  }

  /** Start the task in the running JS runtime and wait for it; false when there is none (use the service). */
  private fun runInProcess(ctx: Context, pushId: String, extras: Bundle): Boolean {
    val rc = liveReactContext(ctx) ?: return false
    val latch = CountDownLatch(1)
    waiters[pushId] = latch
    var started = false
    val startedLatch = CountDownLatch(1)
    UiThreadUtil.runOnUiThread {
      try {
        HeadlessJsTaskContext.getInstance(rc).startTask(
          HeadlessJsTaskConfig(IrisMessageTaskService.TASK_NAME, Arguments.fromBundle(extras), IrisMessageTaskService.TIMEOUT_MS, true),
        )
        started = true
      } catch (e: Exception) {
        Log.w(TAG, "in-process message task failed to start", e)
      } finally {
        startedLatch.countDown()
      }
    }
    if (!startedLatch.await(2, TimeUnit.SECONDS) || !started) {
      waiters.remove(pushId)
      return false // fall back to the service
    }
    latch.await(INLINE_WAIT_MS, TimeUnit.MILLISECONDS)
    waiters.remove(pushId)
    if (pending.containsKey(pushId)) {
      // Still working (slow network): give it more time, then make sure the user hears about the message.
      main.postDelayed({ flushUnhandled(ctx, listOf(pushId)) }, WATCHDOG_MS)
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
    waiters.remove(pushId)?.countDown()
  }

  /** Called when the task service goes away (or the watchdog fires): anything JS did not handle gets the generic notification. */
  fun flushUnhandled(context: Context, ids: Collection<String>) {
    for (id in ids) {
      val kind = pending.remove(id) ?: continue
      Log.w(TAG, "push $id not handled by JS; generic notification")
      MessageNotifier.showGeneric(context, kind)
    }
  }

  private val PUSH_FIELDS = setOf("type", "mid", "eid", "et", "env")
}

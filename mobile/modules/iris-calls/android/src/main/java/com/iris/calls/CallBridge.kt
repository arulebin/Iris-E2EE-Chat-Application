package com.iris.calls

import android.content.Context
import android.content.Intent
import android.os.Bundle

/** Intent extras shared by notifications, telecom and the module. */
object CallExtras {
  const val ACTION = "iris_call_action" // open | answer | decline
  const val CALL_ID = "iris_call_id"
  const val FROM = "iris_call_from"
  const val NAME = "iris_call_name"
  const val VIDEO = "iris_call_video"
  const val FLAG = "iris_call" // marks an intent that came from the call UI (show over lock screen)

  fun put(i: Intent, action: String, callId: String, from: String, name: String, video: Boolean): Intent =
    i.putExtra(FLAG, true).putExtra(ACTION, action).putExtra(CALL_ID, callId)
      .putExtra(FROM, from).putExtra(NAME, name).putExtra(VIDEO, video)

  fun launchIntent(ctx: Context): Intent? =
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

  /** Pull a call action out of an activity intent (once: the extras are removed). */
  fun consume(i: Intent?): Map<String, Any?>? {
    if (i == null || !i.getBooleanExtra(FLAG, false)) return null
    val action = i.getStringExtra(ACTION) ?: return null
    val m = mapOf(
      "action" to action,
      "callId" to i.getStringExtra(CALL_ID),
      "from" to i.getStringExtra(FROM),
      "name" to i.getStringExtra(NAME),
      "video" to i.getBooleanExtra(VIDEO, false),
    )
    i.removeExtra(ACTION)
    return m
  }
}

/**
 * Hands call actions (Answer/Decline/hang-up from notifications and the system
 * call UI) to JS. Until JS says it is ready they queue up, so an Answer tapped
 * while the app was dead is delivered once React has mounted.
 */
object CallBridge {
  @Volatile var sink: ((String, Map<String, Any?>) -> Unit)? = null
  @Volatile var jsReady = false
  private val pending = ArrayList<Map<String, Any?>>()

  @Synchronized
  fun emitAction(payload: Map<String, Any?>) {
    val s = sink
    if (s != null && jsReady) s("onCallAction", payload) else pending.add(payload)
  }

  fun emit(name: String, payload: Map<String, Any?>) {
    sink?.invoke(name, payload)
  }

  @Synchronized
  fun drain(): List<Map<String, Any?>> {
    val out = ArrayList(pending)
    pending.clear()
    return out
  }

  fun action(type: String, callId: String?, from: String? = null, video: Boolean = false) =
    emitAction(mapOf("action" to type, "callId" to callId, "from" to from, "video" to video))

  @Suppress("unused")
  fun bundleOf(vararg p: Pair<String, Any?>): Bundle = Bundle().also { b ->
    for ((k, v) in p) when (v) {
      is String -> b.putString(k, v)
      is Boolean -> b.putBoolean(k, v)
      is Int -> b.putInt(k, v)
    }
  }
}

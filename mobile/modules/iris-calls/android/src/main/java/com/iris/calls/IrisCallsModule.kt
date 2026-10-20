package com.iris.calls

import android.app.Activity
import android.content.Context
import android.os.Build
import android.util.Rational
import android.view.View
import android.view.WindowManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class IrisCallsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val activity: Activity?
    get() = appContext.currentActivity

  private var lastPip = false
  private var pipListener: View.OnLayoutChangeListener? = null
  private var pipView: View? = null
  private var currentCallId: String? = null

  private fun ui(block: (Activity) -> Unit) {
    val a = activity ?: return
    a.runOnUiThread { block(a) }
  }

  override fun definition() = ModuleDefinition {
    Name("IrisCalls")

    Events("onCallAction", "onPipChange", "onAudioDevices")

    OnCreate {
      CallBridge.sink = { name, payload -> sendEvent(name, payload) }
    }

    OnDestroy {
      CallBridge.sink = null
      CallBridge.jsReady = false
    }

    OnNewIntent { intent ->
      CallExtras.consume(intent)?.let { CallBridge.emitAction(it) }
      activity?.let { IrisCallsPackage.showOverLockscreenIfCall(it, intent) }
    }

    OnUserLeavesActivity { /* pre-12 PiP is handled in IrisCallsPackage */ }

    // ── JS bridge ──────────────────────────────────────────────

    /** JS is mounted: returns whatever happened while it was not (Answer tapped on a dead app, …). */
    Function("attach") {
      CallBridge.jsReady = true
      CallExtras.consume(activity?.intent)?.let { CallBridge.emitAction(it) }
      CallBridge.drain()
    }

    Function("detach") { CallBridge.jsReady = false }

    // ── incoming ───────────────────────────────────────────────

    Function("showIncoming") { callId: String, from: String, name: String, video: Boolean ->
      CallNotifier.ensureChannels(context)
      if (CallNotifier.isShowing(callId) || CallTelecom.connections.containsKey(callId)) {
        // Already ringing (push got there first): just refresh the text with the real caller.
        CallNotifier.showIncoming(context, callId, from, name, video)
      } else if (!CallTelecom.addIncoming(context, callId, from, name, video)) {
        CallNotifier.showIncoming(context, callId, from, name, video)
      }
    }

    Function("dismissIncoming") { callId: String? ->
      CallNotifier.cancelIncoming(context, callId)
      callId?.let { id -> CallTelecom.connections[id]?.let { CallTelecom.setActive(id) } }
    }

    Function("canUseFullScreenIntent") { CallNotifier.canUseFullScreenIntent(context) }

    Function("openFullScreenIntentSettings") {
      CallNotifier.fullScreenIntentSettings(context)?.let { context.startActivity(it); true } ?: false
    }

    // ── session (ringing -> connected) ─────────────────────────

    Function("startSession") { callId: String, peer: String, video: Boolean, outgoing: Boolean, speaker: Boolean ->
      currentCallId = callId
      CallNotifier.ensureChannels(context)
      if (outgoing) CallTelecom.placeOutgoing(context, callId, peer, video)
      CallForegroundService.start(context, peer, video)
      CallAudio.start(context, speaker) { payload -> sendEvent("onAudioDevices", payload) }
    }

    Function("updateSession") { peer: String, video: Boolean ->
      CallForegroundService.start(context, peer, video) // restarting refreshes types + notification
    }

    Function("connected") { callId: String ->
      CallTelecom.setActive(callId)
    }

    Function("endSession") { callId: String? ->
      val id = callId ?: currentCallId
      CallTones.stop()
      if (id != null) { CallNotifier.cancelIncoming(context, id); CallTelecom.end(id) }
      CallTelecom.endAll()
      CallForegroundService.stop(context)
      CallAudio.stop(context)
      currentCallId = null
      ui { a ->
        a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        IrisCallsPackage.setShowOverLockscreen(a, false)
      }
      PipState.enabled = false
      ui { a -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) a.setPictureInPictureParams(PipState.params()) }
    }

    // ── audio / tones ──────────────────────────────────────────

    Function("setSpeaker") { on: Boolean -> CallAudio.setSpeaker(context, on) }
    Function("audioState") { CallAudio.state(context) }
    Function("setProximity") { on: Boolean -> CallAudio.setProximity(context, on) }
    Function("playRingback") { CallTones.startRingback() }
    Function("playRingtone") { CallTones.startRingtone(context) }
    Function("stopTones") { CallTones.stop() }

    // ── window ─────────────────────────────────────────────────

    Function("setKeepAwake") { on: Boolean ->
      ui { a ->
        if (on) a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    Function("setShowOverLockscreen") { on: Boolean -> ui { IrisCallsPackage.setShowOverLockscreen(it, on) } }

    Function("moveTaskToBack") { activity?.moveTaskToBack(true) }

    Function("setPip") { enabled: Boolean, width: Int, height: Int ->
      PipState.enabled = enabled
      if (width > 0 && height > 0) PipState.aspect = Rational(width, height)
      ui { a ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) a.setPictureInPictureParams(PipState.params())
        if (enabled) watchPip(a) else unwatchPip()
      }
    }

    Function("isInPip") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity?.isInPictureInPictureMode == true
    }
  }

  /** PiP has no direct callback in the module DSL; the window resizing is the reliable signal. */
  private fun watchPip(a: Activity) {
    if (pipListener != null) return
    val view = a.window.decorView
    val l = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
      val now = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && a.isInPictureInPictureMode
      if (now != lastPip) {
        lastPip = now
        sendEvent("onPipChange", mapOf("active" to now))
      }
    }
    view.addOnLayoutChangeListener(l)
    pipListener = l
    pipView = view
  }

  private fun unwatchPip() {
    pipListener?.let { pipView?.removeOnLayoutChangeListener(it) }
    pipListener = null
    pipView = null
    if (lastPip) { lastPip = false; sendEvent("onPipChange", mapOf("active" to false)) }
  }
}

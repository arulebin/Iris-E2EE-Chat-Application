package com.iris.calls

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import java.util.concurrent.ConcurrentHashMap

/**
 * Self-managed Telecom integration. Registering the call with the system gives us
 * the things a plain notification cannot: the OS arbitrates against cellular calls,
 * Bluetooth/car kits see the call, and the process is exempt from background-start
 * limits while the call is ringing. All of it is best effort — every entry point
 * returns false instead of throwing, and callers fall back to notification + FGS.
 */
object CallTelecom {
  private const val ACCOUNT_ID = "iris-calls"
  const val EXTRA_CALL_ID = "iris_call_id"
  const val EXTRA_FROM = "iris_call_from"
  const val EXTRA_NAME = "iris_call_name"
  const val EXTRA_VIDEO = "iris_call_video"

  val connections = ConcurrentHashMap<String, CallConnection>()

  private fun handle(ctx: Context) =
    PhoneAccountHandle(ComponentName(ctx, IrisConnectionService::class.java), ACCOUNT_ID)

  private fun tm(ctx: Context) = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager

  private fun register(ctx: Context): Boolean = try {
    val account = PhoneAccount.builder(handle(ctx), "Iris")
      .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
      .addSupportedUriScheme("iris")
      .build()
    tm(ctx).registerPhoneAccount(account)
    true
  } catch (_: Exception) {
    false
  }

  fun addIncoming(ctx: Context, callId: String, from: String, name: String, video: Boolean): Boolean {
    val app = ctx.applicationContext
    return try {
      if (!register(app)) return false
      val extras = Bundle().apply {
        putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, Bundle().apply {
          putString(EXTRA_CALL_ID, callId); putString(EXTRA_FROM, from); putString(EXTRA_NAME, name); putBoolean(EXTRA_VIDEO, video)
        })
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle(app))
        putInt(TelecomManager.EXTRA_INCOMING_VIDEO_STATE, if (video) 3 else 0)
      }
      tm(app).addNewIncomingCall(handle(app), extras)
      true
    } catch (_: Exception) {
      false
    }
  }

  fun placeOutgoing(ctx: Context, callId: String, peer: String, video: Boolean): Boolean {
    val app = ctx.applicationContext
    return try {
      if (!register(app)) return false
      val extras = Bundle().apply {
        putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle(app))
        putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS, Bundle().apply {
          putString(EXTRA_CALL_ID, callId); putString(EXTRA_FROM, peer); putString(EXTRA_NAME, peer); putBoolean(EXTRA_VIDEO, video)
        })
      }
      tm(app).placeCall(Uri.fromParts("iris", peer, null), extras)
      true
    } catch (_: Exception) {
      false
    }
  }

  fun setActive(callId: String) { connections[callId]?.setActive() }

  fun end(callId: String) {
    connections.remove(callId)?.let {
      it.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
      it.destroy()
    }
  }

  fun endAll() { for (id in connections.keys.toList()) end(id) }
}

class CallConnection(val ctx: Context, val callId: String, val from: String, val name: String, val video: Boolean, val incoming: Boolean) : Connection() {
  init {
    connectionProperties = PROPERTY_SELF_MANAGED
    connectionCapabilities = CAPABILITY_MUTE
    audioModeIsVoip = true
    setAddress(Uri.fromParts("iris", from, null), TelecomManager.PRESENTATION_ALLOWED)
    setCallerDisplayName(name, TelecomManager.PRESENTATION_ALLOWED)
  }

  override fun onShowIncomingCallUi() {
    CallNotifier.showIncoming(ctx, callId, from, name, video)
  }

  override fun onAnswer() = answered()
  override fun onAnswer(videoState: Int) = answered()

  private fun answered() {
    setActive()
    CallNotifier.cancelIncoming(ctx, callId)
    CallBridge.action("answer", callId, from, video)
    CallExtras.launchIntent(ctx)?.let {
      CallExtras.put(it, "answer", callId, from, name, video)
      try { ctx.startActivity(it) } catch (_: Exception) {}
    }
  }

  override fun onReject() {
    CallNotifier.cancelIncoming(ctx, callId)
    setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
    destroy()
    CallTelecom.connections.remove(callId)
    CallBridge.action("decline", callId, from, video)
  }

  override fun onDisconnect() {
    CallNotifier.cancelIncoming(ctx, callId)
    setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
    destroy()
    CallTelecom.connections.remove(callId)
    CallBridge.action("hangup", callId, from, video)
  }

  override fun onAbort() = onDisconnect()
}

class IrisConnectionService : ConnectionService() {
  override fun onCreateIncomingConnection(account: PhoneAccountHandle?, request: ConnectionRequest?): Connection {
    val x = request?.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
    val c = CallConnection(
      applicationContext, x?.getString(CallTelecom.EXTRA_CALL_ID) ?: "call", x?.getString(CallTelecom.EXTRA_FROM) ?: "",
      x?.getString(CallTelecom.EXTRA_NAME) ?: "Iris", x?.getBoolean(CallTelecom.EXTRA_VIDEO) ?: false, true,
    )
    c.setRinging()
    CallTelecom.connections[c.callId] = c
    return c
  }

  override fun onCreateIncomingConnectionFailed(account: PhoneAccountHandle?, request: ConnectionRequest?) {
    // System refused (another call, restricted): show the plain notification instead.
    val x = request?.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS) ?: return
    CallNotifier.showIncoming(
      applicationContext, x.getString(CallTelecom.EXTRA_CALL_ID) ?: return, x.getString(CallTelecom.EXTRA_FROM) ?: "",
      x.getString(CallTelecom.EXTRA_NAME) ?: "Iris", x.getBoolean(CallTelecom.EXTRA_VIDEO),
    )
  }

  override fun onCreateOutgoingConnection(account: PhoneAccountHandle?, request: ConnectionRequest?): Connection {
    val x = request?.extras?.getBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS)
    val c = CallConnection(
      applicationContext, x?.getString(CallTelecom.EXTRA_CALL_ID) ?: "call", x?.getString(CallTelecom.EXTRA_FROM) ?: "",
      x?.getString(CallTelecom.EXTRA_NAME) ?: "Iris", x?.getBoolean(CallTelecom.EXTRA_VIDEO) ?: false, false,
    )
    c.setDialing()
    CallTelecom.connections[c.callId] = c
    return c
  }
}

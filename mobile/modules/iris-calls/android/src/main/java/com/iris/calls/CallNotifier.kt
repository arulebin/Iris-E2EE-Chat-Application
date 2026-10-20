package com.iris.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import java.util.concurrent.ConcurrentHashMap

/**
 * Incoming-call notification (full-screen intent over the lock screen, Answer /
 * Decline actions) and the ongoing-call notification used by the foreground service.
 * Notification text carries the caller name only on the lock screen's private
 * version of the notification: a public version shows just "Incoming call".
 */
object CallNotifier {
  const val CH_INCOMING = "iris_calls_incoming"
  const val CH_ONGOING = "iris_calls_ongoing"
  const val ONGOING_ID = 0x1215
  private const val RING_TIMEOUT_MS = 45_000L

  private val shown = ConcurrentHashMap.newKeySet<String>()

  fun isShowing(callId: String) = shown.contains(callId)

  fun incomingId(callId: String) = 0x2000 + (callId.hashCode() and 0x0FFF)

  private fun nm(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val n = nm(ctx)
    // Silent: CallTones plays the ringtone itself so it can loop and stop exactly with the call.
    val incoming = NotificationChannel(CH_INCOMING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Rings when someone calls you on Iris"
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      setBypassDnd(false)
    }
    val ongoing = NotificationChannel(CH_ONGOING, "Ongoing call", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shown while a call is in progress"
      setSound(null, null)
      enableVibration(false)
    }
    n.createNotificationChannel(incoming)
    n.createNotificationChannel(ongoing)
  }

  private fun activityIntent(ctx: Context, action: String, callId: String, from: String, name: String, video: Boolean, req: Int): PendingIntent? {
    val launch = CallExtras.launchIntent(ctx) ?: return null
    CallExtras.put(launch, action, callId, from, name, video)
    // Distinct request codes keep the three PendingIntents for one call apart (no data URI: expo-router would try to route it).
    return PendingIntent.getActivity(ctx, req, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun canUseFullScreenIntent(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE || nm(ctx).canUseFullScreenIntent()

  fun fullScreenIntentSettings(ctx: Context): Intent? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
      Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    else null

  /** Post the ringing notification and start the ringtone. Safe to call without JS running. */
  fun showIncoming(ctx: Context, callId: String, from: String, name: String, video: Boolean) {
    val app = ctx.applicationContext
    ensureChannels(app)
    val id = incomingId(callId)
    val open = activityIntent(app, "open", callId, from, name, video, id)
    val answer = activityIntent(app, "answer", callId, from, name, video, id + 1)
    val decline = activityIntent(app, "decline", callId, from, name, video, id + 2)

    val caller = Person.Builder().setName(name).setImportant(true).build()
    val label = if (video) "Iris video call" else "Iris voice call"
    val publicVersion = NotificationCompat.Builder(app, CH_INCOMING)
      .setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle("Incoming call").build()

    val b = NotificationCompat.Builder(app, CH_INCOMING)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle(name)
      .setContentText(label)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setTimeoutAfter(RING_TIMEOUT_MS)
      .setContentIntent(open)
    if (answer != null && decline != null) {
      b.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
    }
    if (open != null && canUseFullScreenIntent(app)) b.setFullScreenIntent(open, true)

    nm(app).notify(id, b.build())
    // First time for this call: start ringing. Later calls only refresh the text (e.g. the caller's name once the offer arrives).
    if (shown.add(callId)) CallTones.startRingtone(app)
  }

  fun cancelIncoming(ctx: Context, callId: String?) {
    CallTones.stop()
    if (callId != null) { shown.remove(callId); nm(ctx).cancel(incomingId(callId)) } else shown.clear()
  }

  /** The notification attached to [CallForegroundService]. */
  fun ongoing(ctx: Context, peer: String, video: Boolean): Notification {
    ensureChannels(ctx)
    val open = CallExtras.launchIntent(ctx)?.let {
      CallExtras.put(it, "open", "", peer, peer, video)
      PendingIntent.getActivity(ctx, ONGOING_ID, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val hangUp = PendingIntent.getBroadcast(
      ctx, ONGOING_ID + 1,
      Intent(ctx, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_HANGUP).setPackage(ctx.packageName),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val person = Person.Builder().setName(peer).setImportant(true).build()
    return NotificationCompat.Builder(ctx, CH_ONGOING)
      .setSmallIcon(android.R.drawable.sym_action_call)
      .setContentTitle(peer)
      .setContentText(if (video) "Iris video call" else "Iris voice call")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setUsesChronometer(true)
      .setContentIntent(open)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp))
      .build()
  }
}

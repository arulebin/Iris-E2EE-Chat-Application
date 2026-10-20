package com.iris.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject

/**
 * Renders message notifications. JS owns the state (it decrypted the messages and keeps them, encrypted at
 * rest, in its own store) and passes the full current view of one conversation each time; nothing here is
 * persisted, so no plaintext ever lands in unencrypted app storage. The system keeps the posted notification.
 *
 *  - one MessagingStyle notification per conversation (tag = chat id), grouped under a summary;
 *  - channel "messages", visibility PRIVATE with a public version that only says "New message";
 *  - inline Reply (RemoteInput) and Mark as read actions -> [MessageActionReceiver];
 *  - tapping opens iris://chat/<id>.
 */
object MessageNotifier {
  const val CHANNEL = "messages"
  const val ACTION_REPLY = "com.iris.notify.REPLY"
  const val ACTION_READ = "com.iris.notify.READ"
  const val EXTRA_CHAT = "chatId"
  const val KEY_REPLY = "iris_reply"

  private const val GROUP = "com.iris.messages"
  private const val CHAT_ID = 0x1A15
  private const val SUMMARY_ID = 0x1A16
  private const val GENERIC_TAG = "iris:generic"
  private const val SOCIAL_TAG = "iris:social"
  private fun tagOf(chatId: String) = "chat:$chatId"

  private fun manager(ctx: Context) = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = manager(ctx)
    if (nm.getNotificationChannel(CHANNEL) != null) return // created by JS (expo-notifications) or earlier
    val ch = NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "New message alerts"
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 250, 250, 250)
    }
    nm.createNotificationChannel(ch)
  }

  private fun smallIcon(ctx: Context): Int {
    val id = ctx.resources.getIdentifier("iris_notify_icon", "drawable", ctx.packageName)
    return if (id != 0) id else android.R.drawable.sym_action_chat
  }

  private fun accent(): Int = Color.parseColor("#7C5CFF")

  private fun openIntent(ctx: Context, path: String, req: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("iris://$path"))
      .setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(ctx, req, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun actionIntent(ctx: Context, action: String, chatId: String, mutable: Boolean): PendingIntent {
    val intent = Intent(ctx, MessageActionReceiver::class.java).setAction(action).putExtra(EXTRA_CHAT, chatId)
    // RemoteInput must be able to add the typed text, so the reply intent is mutable (explicit component).
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(ctx, (action + chatId).hashCode(), intent, flags)
  }

  private fun publicVersion(ctx: Context, text: String = "New message"): Notification =
    NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(smallIcon(ctx))
      .setColor(accent())
      .setContentTitle("Iris")
      .setContentText(text)
      .build()

  // ── avatars: the same gradient + initials the app draws ───────────────

  private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val s = when {
      parts.isEmpty() -> "?"
      parts.size == 1 -> parts[0].take(1)
      else -> parts[0].take(1) + parts[1].take(1)
    }
    return s.uppercase()
  }

  private fun avatar(name: String, c1: String?, c2: String?): IconCompat? = try {
    val size = 128
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val a = if (c1 != null) Color.parseColor(c1) else accent()
    val b = if (c2 != null) Color.parseColor(c2) else a
    val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(0f, 0f, size.toFloat(), size.toFloat(), a, b, Shader.TileMode.CLAMP)
    }
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, bg)
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textSize = size * 0.4f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      textAlign = Paint.Align.CENTER
    }
    val y = size / 2f - (text.descent() + text.ascent()) / 2f
    canvas.drawText(initials(name), size / 2f, y, text)
    IconCompat.createWithBitmap(bmp)
  } catch (_: Exception) {
    null
  }

  // ── conversations ──────────────────────────────────────────────────

  /** `json`: see mobile/src/notify/format.ts (ConversationNotification). */
  fun showConversation(ctx: Context, json: String) {
    val o = JSONObject(json)
    val chatId = o.getString("chatId")
    val title = o.optString("title", "Iris")
    val group = o.optBoolean("group", false)
    val preview = o.optBoolean("preview", true)
    val unread = o.optInt("unread", 0)
    val silent = o.optBoolean("silent", false)
    val lines = o.optJSONArray("lines")
    ensureChannel(ctx)

    val b = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(smallIcon(ctx))
      .setColor(accent())
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(ctx))
      .setGroup(GROUP)
      // Inside a summary group the children alert; the summary stays silent.
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setAutoCancel(true)
      .setContentIntent(openIntent(ctx, "chat/" + Uri.encode(chatId), chatId.hashCode()))
      .setOnlyAlertOnce(silent)
      .setSilent(silent)
    if (unread > 1) b.setNumber(unread)

    val read = NotificationCompat.Action.Builder(0, "Mark as read", actionIntent(ctx, ACTION_READ, chatId, false))
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()

    if (!preview || lines == null || lines.length() == 0) {
      b.setContentTitle("Iris")
        .setContentText(if (unread > 1) "$unread new messages" else "New message")
        .addAction(read)
    } else {
      val me = Person.Builder().setName("You").setKey("iris:me").build()
      val style = NotificationCompat.MessagingStyle(me)
      if (group) style.setConversationTitle(title).setGroupConversation(true)
      var last = 0L
      val people = HashMap<String, Person>()
      for (i in 0 until lines.length()) {
        val l = lines.getJSONObject(i)
        val at = l.optLong("at", System.currentTimeMillis())
        last = maxOf(last, at)
        val text = l.optString("text", "")
        val sender = if (l.optBoolean("me", false)) null else {
          val name = l.optString("sender", "?")
          val key = l.optString("key", name)
          people.getOrPut(key) {
            val p = Person.Builder().setName(name).setKey(key)
            avatar(name, l.optString("c1").ifEmpty { null }, l.optString("c2").ifEmpty { null })?.let { p.setIcon(it) }
            p.build()
          }
        }
        style.addMessage(NotificationCompat.MessagingStyle.Message(text, at, sender))
      }
      b.setStyle(style).setWhen(if (last > 0) last else System.currentTimeMillis()).setShowWhen(true)
      b.setContentTitle(title)
      val remote = RemoteInput.Builder(KEY_REPLY).setLabel("Reply").build()
      val reply = NotificationCompat.Action.Builder(0, "Reply", actionIntent(ctx, ACTION_REPLY, chatId, true))
        .addRemoteInput(remote)
        .setAllowGeneratedReplies(false)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build()
      b.addAction(reply).addAction(read)
    }
    notifySafely(ctx, tagOf(chatId), CHAT_ID, b.build())
    updateSummary(ctx)
  }

  fun cancelConversation(ctx: Context, chatId: String) {
    manager(ctx).cancel(tagOf(chatId), CHAT_ID)
    updateSummary(ctx)
  }

  fun cancelAll(ctx: Context) {
    val nm = manager(ctx)
    for (sbn in nm.activeNotifications) {
      if (sbn.notification.group == GROUP || sbn.tag == GENERIC_TAG || sbn.tag == SOCIAL_TAG) nm.cancel(sbn.tag, sbn.id)
    }
  }

  /** After an inline reply could not even be handed to JS: stop the spinner and say so. */
  fun markReplyFailed(ctx: Context, chatId: String) {
    val nm = manager(ctx)
    val sbn = nm.activeNotifications.firstOrNull { it.tag == tagOf(chatId) && it.id == CHAT_ID } ?: return
    val rebuilt = Notification.Builder.recoverBuilder(ctx, sbn.notification)
      .setSubText("Reply not sent. Open Iris to retry")
      .setOnlyAlertOnce(true)
      .build()
    notifySafely(ctx, sbn.tag, sbn.id, rebuilt)
  }

  private fun updateSummary(ctx: Context) {
    val nm = manager(ctx)
    val children = nm.activeNotifications.filter { it.notification.group == GROUP && it.id == CHAT_ID }
    if (children.isEmpty()) {
      nm.cancel(SUMMARY_ID)
      return
    }
    val summary = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(smallIcon(ctx))
      .setColor(accent())
      .setContentTitle("Iris")
      .setContentText(if (children.size == 1) "New messages" else "Messages in ${children.size} chats")
      .setStyle(NotificationCompat.InboxStyle().setSummaryText("${children.size} chats"))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(ctx))
      .setGroup(GROUP)
      .setGroupSummary(true)
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setSilent(true)
      .setAutoCancel(true)
      .setContentIntent(openIntent(ctx, "", SUMMARY_ID))
      .build()
    notifySafely(ctx, null, SUMMARY_ID, summary)
  }

  // ── generic / social ───────────────────────────────────────────────

  /** No decrypted content available (locked, failed, JS never ran): say only that something arrived. */
  fun showGeneric(ctx: Context, kind: String) {
    ensureChannel(ctx)
    val request = kind == "request"
    val text = if (request) "New connection request" else "New message"
    val n = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(smallIcon(ctx))
      .setColor(accent())
      .setContentTitle("Iris")
      .setContentText(text)
      .setCategory(if (request) NotificationCompat.CATEGORY_SOCIAL else NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(ctx, text))
      .setAutoCancel(true)
      .setContentIntent(openIntent(ctx, if (request) "requests" else "", if (request) 0x1A18 else 0x1A17))
      .build()
    notifySafely(ctx, if (request) SOCIAL_TAG else GENERIC_TAG, if (request) 2 else 1, n)
  }

  fun cancelGeneric(ctx: Context) {
    manager(ctx).cancel(GENERIC_TAG, 1)
  }

  fun showSocial(ctx: Context, title: String, body: String, path: String) {
    ensureChannel(ctx)
    val n = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(smallIcon(ctx))
      .setColor(accent())
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_SOCIAL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(ctx, "New notification"))
      .setAutoCancel(true)
      .setContentIntent(openIntent(ctx, path, 0x1A18))
      .build()
    notifySafely(ctx, SOCIAL_TAG, 2, n)
  }

  private fun notifySafely(ctx: Context, tag: String?, id: Int, n: Notification) {
    try {
      NotificationManagerCompat.from(ctx).notify(tag, id, n)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS not granted: nothing to show, and nothing to crash over.
    }
  }
}

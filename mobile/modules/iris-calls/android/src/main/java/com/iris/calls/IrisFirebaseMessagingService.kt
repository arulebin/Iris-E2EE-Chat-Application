package com.iris.calls

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * The app's single FirebaseMessagingService. expo-notifications ships its own one; FCM delivers to the
 * highest-priority service for the MESSAGING_EVENT action, so this one (default priority 0, Expo's is -1)
 * wins and extends Expo's so every non-call message, token refresh and deletion still goes through
 * expo-notifications unchanged.
 *
 * Data-only "incoming-call" / "call-cancelled" messages are handled natively with NO JS running
 * (docs/mobile-calls.md): Telecom ring + full-screen intent, or a cancel of that ring.
 * Data-only "msg" / "msg-wake" / "friend-*" messages start the headless JS task (com.iris.notify.MessagePush).
 */
class IrisFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    if (remoteMessage.notification == null && (data["type"] == "incoming-call" || data["type"] == "call-cancelled")) {
      try {
        if (IrisCallPush.handle(applicationContext, data)) return
      } catch (e: Exception) {
        android.util.Log.w("IrisFcm", "call push handling failed", e)
      }
    }
    // Data-only message / connection pushes: decrypted and notified by the app itself (com.iris.notify).
    if (remoteMessage.notification == null && data["type"] in com.iris.notify.MessagePush.TYPES) {
      try {
        if (com.iris.notify.MessagePush.handle(applicationContext, data)) return
      } catch (e: Exception) {
        android.util.Log.w("IrisFcm", "message push handling failed", e)
        com.iris.notify.MessageNotifier.showGeneric(applicationContext, "message")
        return
      }
    }
    super.onMessageReceived(remoteMessage)
  }

  /** FCM discarded queued messages for this device: fetch whatever is pending instead. */
  override fun onDeletedMessages() {
    try {
      com.iris.notify.MessagePush.onDeleted(applicationContext)
    } catch (e: Exception) {
      android.util.Log.w("IrisFcm", "wake after deleted messages failed", e)
    }
    super.onDeletedMessages()
  }
}

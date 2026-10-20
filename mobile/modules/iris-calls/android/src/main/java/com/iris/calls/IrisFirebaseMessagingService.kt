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
    super.onMessageReceived(remoteMessage)
  }
}

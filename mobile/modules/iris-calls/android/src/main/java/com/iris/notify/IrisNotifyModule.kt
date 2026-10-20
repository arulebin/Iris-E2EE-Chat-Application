package com.iris.notify

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side of the message notifications (mobile/src/notify/native.ts). Its presence = data-push capable build. */
class IrisNotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("IrisNotify")

    Constants("version" to 1)

    Function("showConversation") { json: String -> MessageNotifier.showConversation(context, json) }
    Function("cancelConversation") { chatId: String -> MessageNotifier.cancelConversation(context, chatId) }
    Function("cancelAll") { MessageNotifier.cancelAll(context) }
    Function("showGeneric") { kind: String -> MessageNotifier.showGeneric(context, kind) }
    Function("cancelGeneric") { MessageNotifier.cancelGeneric(context) }
    Function("showSocial") { title: String, body: String, path: String -> MessageNotifier.showSocial(context, title, body, path) }
    Function("handled") { pushId: String -> MessagePush.handled(pushId) }
  }
}

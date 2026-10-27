package com.iris.notify

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
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

    // ── background delivery on OEM ROMs (MIUI/HyperOS, ColorOS, Funtouch, EMUI…) ──
    Function("backgroundStatus") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      mapOf(
        "manufacturer" to Build.MANUFACTURER.lowercase(),
        "ignoringBatteryOptimizations" to pm.isIgnoringBatteryOptimizations(context.packageName),
        "hasAutostartSettings" to (autostartIntent() != null),
      )
    }

    /** Opens the OEM "Autostart" page (if any), then the system "let Iris run in the background" dialog on top. */
    Function("openBackgroundSettings") {
      val activity = appContext.currentActivity ?: return@Function false
      var opened = false
      autostartIntent()?.let { opened = tryStart(activity, it) }
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
        @Suppress("BatteryLife") // sideloaded messenger: delivery when backgrounded is the core feature
        val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        opened = tryStart(activity, ask) || opened
      }
      opened
    }
  }

  private fun tryStart(activity: Activity, intent: Intent): Boolean = try {
    activity.startActivity(intent)
    true
  } catch (e: Exception) {
    false
  }

  /** The vendor's autostart manager, when this ROM has one we know. */
  private fun autostartIntent(): Intent? {
    val pm = context.packageManager
    return AUTOSTART.map { (pkg, cls) -> Intent().setComponent(ComponentName(pkg, cls)) }
      .firstOrNull { pm.resolveActivity(it, 0) != null }
  }

  private companion object {
    val AUTOSTART = listOf(
      "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
      "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
      "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
      "com.oplus.safecenter" to "com.oplus.safecenter.permission.startup.StartupAppListActivity",
      "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
      "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
      "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
      "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
      "com.hihonor.systemmanager" to "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    )
  }
}

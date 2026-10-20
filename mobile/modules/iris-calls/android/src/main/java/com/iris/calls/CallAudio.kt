package com.iris.calls

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager

/**
 * Call audio: focus, communication mode, earpiece/speaker/Bluetooth/wired routing
 * (setCommunicationDevice on API 31+, legacy speakerphone before), and the
 * proximity sensor lock that blanks the screen against the ear.
 */
object CallAudio {
  private var focus: AudioFocusRequest? = null
  private var started = false
  private var speaker = false
  private var proximityLock: PowerManager.WakeLock? = null
  private var deviceCallback: AudioDeviceCallback? = null
  private var onDevicesChanged: ((Map<String, Any?>) -> Unit)? = null
  private val main = Handler(Looper.getMainLooper())

  private fun am(ctx: Context) = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  // Private outputs in preference order when the speaker is off.
  private val privateOutputs = intArrayOf(
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
  )

  @Synchronized
  fun start(ctx: Context, speakerOn: Boolean, listener: ((Map<String, Any?>) -> Unit)?) {
    val a = am(ctx)
    if (!started) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
      focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attrs).setAcceptsDelayedFocusGain(false).setWillPauseWhenDucked(false)
        .setOnAudioFocusChangeListener { }.build()
      a.requestAudioFocus(focus!!)
      a.mode = AudioManager.MODE_IN_COMMUNICATION
      started = true
      onDevicesChanged = listener
      deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = devicesChanged(ctx)
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = devicesChanged(ctx)
      }
      a.registerAudioDeviceCallback(deviceCallback, main)
    }
    speaker = speakerOn
    route(ctx)
  }

  private fun devicesChanged(ctx: Context) {
    if (!started) return
    route(ctx) // a headset plugged in mid-call takes over (unless the speaker is forced)
    onDevicesChanged?.invoke(state(ctx))
  }

  @Synchronized
  fun setSpeaker(ctx: Context, on: Boolean) {
    speaker = on
    if (started) route(ctx)
  }

  private fun route(ctx: Context) {
    val a = am(ctx)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = a.availableCommunicationDevices
      var target: AudioDeviceInfo? = null
      if (speaker) {
        target = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      } else {
        for (t in privateOutputs) { target = devices.firstOrNull { it.type == t }; if (target != null) break }
      }
      if (target != null) a.setCommunicationDevice(target)
    } else {
      @Suppress("DEPRECATION")
      a.isSpeakerphoneOn = speaker
    }
  }

  /** What the UI needs: is a headset attached, which output is active. */
  fun state(ctx: Context): Map<String, Any?> {
    val a = am(ctx)
    val outs = a.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val bt = outs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }
    val wired = outs.any { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it.type == AudioDeviceInfo.TYPE_USB_HEADSET }
    return mapOf("speaker" to speaker, "bluetooth" to bt, "wired" to wired, "headset" to (bt || wired))
  }

  @Synchronized
  fun stop(ctx: Context) {
    setProximity(ctx, false)
    if (!started) return
    val a = am(ctx)
    deviceCallback?.let { a.unregisterAudioDeviceCallback(it) }
    deviceCallback = null
    onDevicesChanged = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) a.clearCommunicationDevice()
    else @Suppress("DEPRECATION") { a.isSpeakerphoneOn = false }
    a.mode = AudioManager.MODE_NORMAL
    focus?.let { a.abandonAudioFocusRequest(it) }
    focus = null
    started = false
    speaker = false
  }

  /** Screen off while the phone is at the ear (voice calls without speaker/headset). */
  @Synchronized
  fun setProximity(ctx: Context, on: Boolean) {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    if (on) {
      if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
      if (proximityLock == null) proximityLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "iris:call-proximity")
      if (proximityLock?.isHeld == false) proximityLock?.acquire(4 * 60 * 60 * 1000L)
    } else {
      if (proximityLock?.isHeld == true) proximityLock?.release()
    }
  }
}

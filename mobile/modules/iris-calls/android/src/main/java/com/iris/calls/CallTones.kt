package com.iris.calls

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Incoming ringtone + vibration and the outgoing ringback tone. Owned natively so
 * that a call that arrives while the app is dead (push) rings without any JS.
 */
object CallTones {
  private const val MAX_RING_MS = 45_000L
  private val main = Handler(Looper.getMainLooper())
  private var ringtone: Ringtone? = null
  private var tone: ToneGenerator? = null
  private var vibrator: Vibrator? = null
  private val autoStop = Runnable { stop() }

  @Synchronized
  fun startRingtone(ctx: Context) {
    stop()
    val app = ctx.applicationContext
    val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (am.ringerMode == AudioManager.RINGER_MODE_SILENT) return
    if (am.ringerMode == AudioManager.RINGER_MODE_NORMAL) {
      val uri = RingtoneManager.getActualDefaultRingtoneUri(app, RingtoneManager.TYPE_RINGTONE)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      ringtone = RingtoneManager.getRingtone(app, uri)?.apply {
        audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
        play()
      }
    }
    // Vibrate in both normal and vibrate ringer modes.
    val v = vibrator(app)
    if (v?.hasVibrator() == true) {
      val pattern = longArrayOf(0, 900, 700)
      v.vibrate(VibrationEffect.createWaveform(pattern, 0))
      vibrator = v
    }
    main.postDelayed(autoStop, MAX_RING_MS)
  }

  @Synchronized
  fun startRingback() {
    stop()
    try {
      tone = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 70).also { it.startTone(ToneGenerator.TONE_SUP_RINGTONE) }
    } catch (_: RuntimeException) {
      tone = null
    }
    main.postDelayed(autoStop, MAX_RING_MS)
  }

  @Synchronized
  fun stop() {
    main.removeCallbacks(autoStop)
    try { ringtone?.stop() } catch (_: Exception) {}
    ringtone = null
    try { tone?.stopTone(); tone?.release() } catch (_: Exception) {}
    tone = null
    try { vibrator?.cancel() } catch (_: Exception) {}
    vibrator = null
  }

  private fun vibrator(ctx: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
}

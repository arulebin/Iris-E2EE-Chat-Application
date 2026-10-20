package expo.modules.iriskeystore

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.util.Arrays
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * Android Keystore wrapping for Iris (mirrors the Capacitor KeystorePlugin + AppLockPlugin).
 *
 * Plain wrapper: AES-256-GCM key per alias in AndroidKeyStore (StrongBox when the device has
 * it, TEE otherwise), non-exportable. wrap/unwrap carry base64 so JS never sees the key.
 * App-lock wrapper: a second key per alias that requires user authentication (strong
 * biometric or screen lock) within `timeoutSeconds`, and is invalidated by new biometric
 * enrollment. Enforcement is by the TEE/StrongBox, not this process.
 *
 * Error codes on the JS side (error.code): KEY_MISSING, KEY_INVALIDATED, AUTH_REQUIRED,
 * CANCELED, LOCKOUT, FAILED, BAD_INPUT.
 */
class IrisKeystoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IrisKeystore")

    AsyncFunction("wrap") { alias: String, data: String ->
      guard { encrypt(PLAIN_PREFIX + alias, data, true) }
    }
    AsyncFunction("unwrap") { alias: String, data: String ->
      guard { decrypt(PLAIN_PREFIX + alias, data) }
    }
    AsyncFunction("reset") { alias: String ->
      guard { deleteKey(PLAIN_PREFIX + alias) }
    }
    AsyncFunction("hasKey") { alias: String ->
      guard { loadKey(PLAIN_PREFIX + alias) != null }
    }
    // "strongbox" | "tee" | "software" | "hardware" | "unknown" for an existing plain key.
    AsyncFunction("securityLevel") { alias: String ->
      guard { securityLevel(PLAIN_PREFIX + alias) }
    }

    // ---- app lock ----

    AsyncFunction("lockStatus") {
      val ctx = appContext.reactContext ?: throw CodedException("FAILED", "no context", null)
      when (BiometricManager.from(ctx).canAuthenticate(authenticators())) {
        BiometricManager.BIOMETRIC_SUCCESS -> "available"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none_enrolled"
        else -> "unsupported"
      }
    }

    AsyncFunction("lockAuthenticate") { title: String, subtitle: String?, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) {
        promise.reject(CodedException("FAILED", "no activity", null))
        return@AsyncFunction
      }
      activity.runOnUiThread {
        try {
          val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setAllowedAuthenticators(authenticators())
            .setConfirmationRequired(false)
          if (subtitle != null) info.setSubtitle(subtitle)
          BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
              override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                promise.resolve(null)
              }

              override fun onAuthenticationError(code: Int, msg: CharSequence) {
                val c = when (code) {
                  BiometricPrompt.ERROR_USER_CANCELED,
                  BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                  BiometricPrompt.ERROR_CANCELED -> "CANCELED"
                  BiometricPrompt.ERROR_LOCKOUT,
                  BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "LOCKOUT"
                  else -> "FAILED"
                }
                promise.reject(CodedException(c, msg.toString(), null))
              }
            }
          ).authenticate(info.build())
        } catch (e: Exception) {
          promise.reject(CodedException("FAILED", "authenticate failed: " + e.message, e))
        }
      }
    }

    AsyncFunction("lockCreateKey") { alias: String, timeoutSeconds: Int ->
      guard { createLockKey(LOCK_PREFIX + alias, timeoutSeconds) }
    }
    AsyncFunction("lockDeleteKey") { alias: String -> guard { deleteKey(LOCK_PREFIX + alias) } }
    AsyncFunction("lockWrap") { alias: String, data: String ->
      guard { encrypt(LOCK_PREFIX + alias, data, false) }
    }
    AsyncFunction("lockUnwrap") { alias: String, data: String ->
      guard { decrypt(LOCK_PREFIX + alias, data) }
    }
  }

  // ---- helpers ----

  private inline fun <T> guard(block: () -> T): T {
    try {
      return block()
    } catch (e: CodedException) {
      throw e
    } catch (e: KeyPermanentlyInvalidatedException) {
      throw CodedException("KEY_INVALIDATED", "Key invalidated", e)
    } catch (e: UserNotAuthenticatedException) {
      throw CodedException("AUTH_REQUIRED", "User authentication required", e)
    } catch (e: Exception) {
      throw CodedException("FAILED", e.message ?: e.javaClass.simpleName, e)
    }
  }

  private fun authenticators(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
      BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    else
      BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

  private fun encrypt(alias: String, data: String, createIfMissing: Boolean): String {
    val plaintext = Base64.decode(data, Base64.NO_WRAP)
    try {
      val key = loadKey(alias)
        ?: if (createIfMissing) createPlainKey(alias) else throw CodedException("KEY_MISSING", "No Keystore key", null)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key) // randomized encryption: Keystore picks the IV
      val iv = cipher.iv
      val ct = cipher.doFinal(plaintext)
      val out = ByteArray(iv.size + ct.size)
      System.arraycopy(iv, 0, out, 0, iv.size)
      System.arraycopy(ct, 0, out, iv.size, ct.size)
      return Base64.encodeToString(out, Base64.NO_WRAP)
    } finally {
      Arrays.fill(plaintext, 0.toByte())
    }
  }

  private fun decrypt(alias: String, data: String): String {
    // Keystore entry gone (app data cleared, device restored): the blob is unrecoverable.
    val key = loadKey(alias) ?: throw CodedException("KEY_MISSING", "No Keystore key for this alias", null)
    val packed = Base64.decode(data, Base64.NO_WRAP)
    if (packed.size < IV_BYTES + TAG_BITS / 8) throw CodedException("BAD_INPUT", "wrapped blob too short", null)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, Arrays.copyOfRange(packed, 0, IV_BYTES)))
    val plaintext = cipher.doFinal(packed, IV_BYTES, packed.size - IV_BYTES)
    val b64 = Base64.encodeToString(plaintext, Base64.NO_WRAP)
    Arrays.fill(plaintext, 0.toByte())
    return b64
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  private fun loadKey(alias: String): SecretKey? {
    val entry = keyStore().getEntry(alias, null)
    return (entry as? KeyStore.SecretKeyEntry)?.secretKey
  }

  private fun deleteKey(alias: String) {
    val ks = keyStore()
    if (ks.containsAlias(alias)) ks.deleteEntry(alias)
  }

  private fun securityLevel(alias: String): String {
    val key = loadKey(alias) ?: throw CodedException("KEY_MISSING", "No Keystore key", null)
    return try {
      val factory = SecretKeyFactory.getInstance(key.algorithm, PROVIDER)
      val info = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        when (info.securityLevel) {
          KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
          KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
          KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
          else -> "unknown"
        }
      } else if (info.isInsideSecureHardware) "hardware" else "software"
    } catch (e: Exception) {
      "unknown"
    }
  }

  private fun createLockKey(alias: String, timeoutSeconds: Int) {
    deleteKey(alias)
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setRandomizedEncryptionRequired(true)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
    val t = maxOf(1, timeoutSeconds)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      spec.setUserAuthenticationParameters(t, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
    } else {
      @Suppress("DEPRECATION")
      spec.setUserAuthenticationValidityDurationSeconds(t)
    }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    gen.init(spec.build())
    gen.generateKey()
  }

  private fun createPlainKey(alias: String): SecretKey {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        return generatePlain(alias, true)
      } catch (e: StrongBoxUnavailableException) {
        // No StrongBox secure element: fall back to the TEE.
      }
    }
    return generatePlain(alias, false)
  }

  private fun generatePlain(alias: String, strongBox: Boolean): SecretKey {
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .setRandomizedEncryptionRequired(true)
      .setUserAuthenticationRequired(false)
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true)
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    gen.init(spec.build())
    return gen.generateKey()
  }

  companion object {
    private const val PROVIDER = "AndroidKeyStore"
    private const val PLAIN_PREFIX = "iris-storage-wrap:"
    private const val LOCK_PREFIX = "iris-applock:"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }
}

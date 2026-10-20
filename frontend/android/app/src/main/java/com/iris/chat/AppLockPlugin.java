package com.iris.chat;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Biometric / device-credential "App lock".
 *
 * The lock is cryptographic, not just a screen: an AES-256-GCM Keystore key
 * ("iris-applock:USER") that requires user authentication wraps the at-rest
 * storage keys (a second layer on top of KeystorePlugin's). The Keystore
 * refuses to use the key unless the user authenticated with a strong biometric
 * or their screen-lock credential within the last few seconds (enforced by the
 * TEE / StrongBox, not by this app), so code running in the app process can't
 * decrypt anything without a fresh authentication. The key is invalidated when
 * a new biometric is enrolled, so a freshly added fingerprint can't open it.
 *
 * JS errors carry a code: AUTH_REQUIRED (no recent authentication),
 * KEY_INVALIDATED / KEY_MISSING (key unusable: fall back to the password flow),
 * CANCELED, LOCKOUT, FAILED.
 */
@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {

    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS_PREFIX = "iris-applock:";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    /** Strong biometric or screen-lock credential. API 28-29 can't combine STRONG with DEVICE_CREDENTIAL. */
    private static int authenticators() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    /** "available" | "none_enrolled" | "unsupported" */
    @PluginMethod
    public void status(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(authenticators());
        String s;
        switch (r) {
            case BiometricManager.BIOMETRIC_SUCCESS: s = "available"; break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: s = "none_enrolled"; break;
            default: s = "unsupported";
        }
        JSObject ret = new JSObject();
        ret.put("status", s);
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        final String title = call.getString("title", "Unlock Iris");
        final String subtitle = call.getString("subtitle");
        final FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("no activity", "FAILED");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setAllowedAuthenticators(authenticators())
                        .setConfirmationRequired(false);
                if (subtitle != null) info.setSubtitle(subtitle);
                BiometricPrompt prompt = new BiometricPrompt(activity,
                        ContextCompat.getMainExecutor(activity),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                call.resolve();
                            }

                            @Override
                            public void onAuthenticationError(int code, CharSequence msg) {
                                String c;
                                switch (code) {
                                    case BiometricPrompt.ERROR_USER_CANCELED:
                                    case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                                    case BiometricPrompt.ERROR_CANCELED:
                                        c = "CANCELED"; break;
                                    case BiometricPrompt.ERROR_LOCKOUT:
                                    case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                                        c = "LOCKOUT"; break;
                                    default: c = "FAILED";
                                }
                                call.reject(String.valueOf(msg), c);
                            }
                            // onAuthenticationFailed (a rejected finger) is not final: the prompt stays up.
                        });
                prompt.authenticate(info.build());
            } catch (Exception e) {
                call.reject("authenticate failed", "FAILED", e);
            }
        });
    }

    /** Create (replacing any old) auth-required key. timeoutSeconds is the post-authentication window. */
    @PluginMethod
    public void createKey(PluginCall call) {
        String alias = alias(call);
        if (alias == null) { call.reject("alias is required"); return; }
        int timeout = Math.max(1, call.getInt("timeoutSeconds", 20));
        try {
            KeyStore ks = KeyStore.getInstance(PROVIDER);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);

            KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                    alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .setUserAuthenticationRequired(true)
                    .setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                spec.setUserAuthenticationParameters(timeout,
                        KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
            } else {
                spec.setUserAuthenticationValidityDurationSeconds(timeout);
            }
            KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
            gen.init(spec.build());
            gen.generateKey();
            call.resolve();
        } catch (Exception e) {
            call.reject("createKey failed: " + e.getMessage(), "FAILED", e);
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String alias = alias(call);
        if (alias == null) { call.reject("alias is required"); return; }
        try {
            KeyStore ks = KeyStore.getInstance(PROVIDER);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
            call.resolve();
        } catch (Exception e) {
            call.reject("deleteKey failed", "FAILED", e);
        }
    }

    @PluginMethod
    public void wrap(PluginCall call) {
        String alias = alias(call);
        String data = call.getString("data");
        if (alias == null || data == null) { call.reject("alias and data are required"); return; }
        try {
            SecretKey key = key(alias);
            if (key == null) { call.reject("No app-lock key", "KEY_MISSING"); return; }
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);   // throws unless recently authenticated
            byte[] iv = cipher.getIV();
            byte[] plaintext = Base64.decode(data, Base64.NO_WRAP);
            byte[] ct = cipher.doFinal(plaintext);
            Arrays.fill(plaintext, (byte) 0);
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            call.resolve(result(Base64.encodeToString(out, Base64.NO_WRAP)));
        } catch (Exception e) {
            reject(call, "wrap failed", e);
        }
    }

    @PluginMethod
    public void unwrap(PluginCall call) {
        String alias = alias(call);
        String data = call.getString("data");
        if (alias == null || data == null) { call.reject("alias and data are required"); return; }
        try {
            SecretKey key = key(alias);
            if (key == null) { call.reject("No app-lock key", "KEY_MISSING"); return; }
            byte[] packed = Base64.decode(data, Base64.NO_WRAP);
            if (packed.length < IV_BYTES + TAG_BITS / 8) { call.reject("blob too short"); return; }
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(TAG_BITS, Arrays.copyOfRange(packed, 0, IV_BYTES)));
            byte[] plaintext = cipher.doFinal(packed, IV_BYTES, packed.length - IV_BYTES);
            String b64 = Base64.encodeToString(plaintext, Base64.NO_WRAP);
            Arrays.fill(plaintext, (byte) 0);
            call.resolve(result(b64));
        } catch (Exception e) {
            reject(call, "unwrap failed", e);
        }
    }

    // helpers

    private static void reject(PluginCall call, String msg, Exception e) {
        if (e instanceof KeyPermanentlyInvalidatedException) {
            call.reject(msg, "KEY_INVALIDATED", e);
        } else if (e instanceof UserNotAuthenticatedException) {
            call.reject(msg, "AUTH_REQUIRED", e);
        } else {
            call.reject(msg, "FAILED", e);
        }
    }

    private static String alias(PluginCall call) {
        String a = call.getString("alias");
        return (a == null || a.isEmpty()) ? null : ALIAS_PREFIX + a;
    }

    private static JSObject result(String data) {
        JSObject ret = new JSObject();
        ret.put("data", data);
        return ret;
    }

    private static SecretKey key(String alias) throws Exception {
        KeyStore ks = KeyStore.getInstance(PROVIDER);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(alias, null);
        return entry instanceof KeyStore.SecretKeyEntry ? ((KeyStore.SecretKeyEntry) entry).getSecretKey() : null;
    }
}

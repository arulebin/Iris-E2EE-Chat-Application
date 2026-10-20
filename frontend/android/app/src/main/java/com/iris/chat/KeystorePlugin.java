package com.iris.chat;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;

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
 * Wraps small secrets (the Signal "storage key") with an AES-256-GCM key that
 * lives in the Android Keystore — hardware-backed (TEE, or StrongBox when the
 * device has one) and non-exportable. The JS side only ever sees wrapped blobs
 * and the unwrapped secret; the wrapping key itself never leaves the Keystore.
 *
 * One Keystore key per alias, so several local accounts don't share a key and
 * reset() for one account can't break another.
 */
@CapacitorPlugin(name = "Keystore")
public class KeystorePlugin extends Plugin {

    private static final String PROVIDER = "AndroidKeyStore";
    private static final String ALIAS_PREFIX = "iris-storage-wrap:";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    @PluginMethod
    public void wrap(PluginCall call) {
        String alias = alias(call);
        String data = call.getString("data");
        if (alias == null || data == null) {
            call.reject("alias and data are required");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            // Randomized encryption is enforced on the key, so the Keystore picks the IV.
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(alias));
            byte[] iv = cipher.getIV();
            byte[] plaintext = Base64.decode(data, Base64.NO_WRAP);
            byte[] ct = cipher.doFinal(plaintext);
            Arrays.fill(plaintext, (byte) 0);

            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            call.resolve(result(Base64.encodeToString(out, Base64.NO_WRAP)));
        } catch (Exception e) {
            call.reject("wrap failed", e);
        }
    }

    @PluginMethod
    public void unwrap(PluginCall call) {
        String alias = alias(call);
        String data = call.getString("data");
        if (alias == null || data == null) {
            call.reject("alias and data are required");
            return;
        }
        try {
            SecretKey key = getKey(alias);
            if (key == null) {
                // Keystore entry gone (app data cleared, device restored): the blob is unrecoverable.
                call.reject("No Keystore key for this alias", "KEY_MISSING");
                return;
            }
            byte[] packed = Base64.decode(data, Base64.NO_WRAP);
            if (packed.length < IV_BYTES + TAG_BITS / 8) {
                call.reject("wrapped blob too short");
                return;
            }
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(TAG_BITS, Arrays.copyOfRange(packed, 0, IV_BYTES)));
            byte[] plaintext = cipher.doFinal(packed, IV_BYTES, packed.length - IV_BYTES);
            String b64 = Base64.encodeToString(plaintext, Base64.NO_WRAP);
            Arrays.fill(plaintext, (byte) 0);
            call.resolve(result(b64));
        } catch (Exception e) {
            call.reject("unwrap failed", e);
        }
    }

    /** Delete the Keystore key: every blob wrapped under it becomes permanently unreadable. */
    @PluginMethod
    public void reset(PluginCall call) {
        String alias = alias(call);
        if (alias == null) {
            call.reject("alias is required");
            return;
        }
        try {
            KeyStore ks = KeyStore.getInstance(PROVIDER);
            ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
            call.resolve();
        } catch (Exception e) {
            call.reject("reset failed", e);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────

    private static String alias(PluginCall call) {
        String a = call.getString("alias");
        return (a == null || a.isEmpty()) ? null : ALIAS_PREFIX + a;
    }

    private static JSObject result(String data) {
        JSObject ret = new JSObject();
        ret.put("data", data);
        return ret;
    }

    private static SecretKey getKey(String alias) throws Exception {
        KeyStore ks = KeyStore.getInstance(PROVIDER);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(alias, null);
        return entry instanceof KeyStore.SecretKeyEntry ? ((KeyStore.SecretKeyEntry) entry).getSecretKey() : null;
    }

    private static SecretKey getOrCreateKey(String alias) throws Exception {
        SecretKey existing = getKey(alias);
        if (existing != null) return existing;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generate(alias, true);
            } catch (StrongBoxUnavailableException e) {
                // No StrongBox secure element on this device — fall back to the TEE.
            }
        }
        return generate(alias, false);
    }

    private static SecretKey generate(String alias, boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .setUserAuthenticationRequired(false);
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            spec.setIsStrongBoxBacked(true);
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        gen.init(spec.build());
        return gen.generateKey();
    }
}

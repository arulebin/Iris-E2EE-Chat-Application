package com.iris.backend;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;
import java.util.Base64;

@Service
public class MediaEncryption {

    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    @Value("${media.master-key}")
    private String masterKeyB64;

    private SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    @PostConstruct
    void init() {
        byte[] raw = Base64.getDecoder().decode(masterKeyB64);
        if (raw.length != 32) {
            throw new IllegalStateException(
                "media.master-key must decode to exactly 32 bytes (256 bits); got " + raw.length
            );
        }
        this.key = new SecretKeySpec(raw, "AES");
    }

    /** Encrypt and return [IV ‖ ciphertext]. */
    public byte[] encrypt(byte[] plaintext) {
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext);

            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return out;
        } catch (Exception e) {
            throw new RuntimeException("encrypt failed", e);
        }
    }

    public byte[] decrypt(byte[] packed) {
        try {
            if (packed.length < IV_BYTES + 16) {
                throw new IllegalArgumentException("packed media too short");
            }
            byte[] iv = new byte[IV_BYTES];
            System.arraycopy(packed, 0, iv, 0, IV_BYTES);
            byte[] ct = new byte[packed.length - IV_BYTES];
            System.arraycopy(packed, IV_BYTES, ct, 0, ct.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            return cipher.doFinal(ct);
        } catch (Exception e) {
            throw new RuntimeException("decrypt failed", e);
        }
    }
}

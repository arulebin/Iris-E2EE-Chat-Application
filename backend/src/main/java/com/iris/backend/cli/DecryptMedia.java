package com.iris.backend.cli;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;

/**
 * Standalone CLI to decrypt a media blob with the master key.
 * Usage:
 *   java -cp target/classes com.iris.backend.cli.DecryptMedia <encrypted-file> [output-file]
 *
 * Requires the env var MEDIA_MASTER_KEY (base64, 32 bytes when decoded).
 * If output-file is omitted, writes to <encrypted-file>.decrypted.
 *
 * This tool runs OUTSIDE the Spring app so you can decrypt files without booting the server.
 */
public class DecryptMedia {

    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("Usage: DecryptMedia <encrypted-file> [output-file]");
            System.exit(2);
        }

        String keyB64 = System.getenv("MEDIA_MASTER_KEY");
        if (keyB64 == null || keyB64.isBlank()) {
            // Fallback to the dev default so admins on dev boxes can still inspect.
            keyB64 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
            System.err.println("Warning: MEDIA_MASTER_KEY not set; using dev default.");
        }
        byte[] keyBytes = Base64.getDecoder().decode(keyB64);
        if (keyBytes.length != 32) {
            System.err.println("MEDIA_MASTER_KEY must decode to 32 bytes; got " + keyBytes.length);
            System.exit(2);
        }

        Path in = Paths.get(args[0]);
        Path out = args.length > 1
                ? Paths.get(args[1])
                : Paths.get(args[0] + ".decrypted");

        byte[] packed = Files.readAllBytes(in);
        if (packed.length < IV_BYTES + 16) {
            System.err.println("File too short to be a valid encrypted blob.");
            System.exit(1);
        }

        byte[] iv = new byte[IV_BYTES];
        System.arraycopy(packed, 0, iv, 0, IV_BYTES);
        byte[] ct = new byte[packed.length - IV_BYTES];
        System.arraycopy(packed, IV_BYTES, ct, 0, ct.length);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,
                new SecretKeySpec(keyBytes, "AES"),
                new GCMParameterSpec(TAG_BITS, iv));
        byte[] plaintext;
        try {
            plaintext = cipher.doFinal(ct);
        } catch (Exception e) {
            System.err.println("Decryption failed — wrong key or corrupted file: " + e.getMessage());
            System.exit(1);
            return;
        }

        Files.write(out, plaintext);
        System.out.println("Decrypted " + plaintext.length + " bytes → " + out.toAbsolutePath());
    }
}

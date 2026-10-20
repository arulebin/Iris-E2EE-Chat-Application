package com.iris.backend;

import java.security.SecureRandom;

/**
 * Invite codes: 10 Crockford base32 characters (50 bits), shown as XXXXX-XXXXX.
 * Short enough to read out or type, random enough that guessing one is hopeless
 * under the lookup rate limit. Crockford's alphabet drops I/L/O/U, and
 * {@link #normalize} folds common typos (O→0, I/L→1) back in.
 */
public final class InviteCodes {

    static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    static final int LENGTH = 10;

    private static final SecureRandom RANDOM = new SecureRandom();

    private InviteCodes() {}

    /** A fresh random code in canonical form (no separator). */
    public static String generate() {
        char[] out = new char[LENGTH];
        for (int i = 0; i < LENGTH; i++) out[i] = ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length()));
        return new String(out);
    }

    /**
     * Canonical form of user input, or null if it can't be a code. Accepts any case,
     * dashes/spaces, and a full invite URL (`…?add=CODE`).
     */
    public static String normalize(String input) {
        if (input == null) return null;
        String s = input.trim();
        int q = s.indexOf("add=");
        if (q >= 0) {
            s = s.substring(q + 4);
            int amp = s.indexOf('&');
            if (amp >= 0) s = s.substring(0, amp);
        }
        StringBuilder b = new StringBuilder(LENGTH);
        for (char c : s.toUpperCase().toCharArray()) {
            if (c == '-' || c == ' ') continue;
            if (c == 'O') c = '0';
            else if (c == 'I' || c == 'L') c = '1';
            if (ALPHABET.indexOf(c) < 0) return null;
            b.append(c);
        }
        return b.length() == LENGTH ? b.toString() : null;
    }

    /** Display form: XXXXX-XXXXX. */
    public static String format(String code) {
        if (code == null || code.length() != LENGTH) return code;
        return code.substring(0, 5) + "-" + code.substring(5);
    }
}

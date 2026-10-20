package com.iris.backend;

import java.util.List;

public record IncomingMessage(
        String to,
        String content,
        String encryptedKeyForSender,
        String encryptedKeyForRecipient,
        String mediaId,
        String mimeType,
        Boolean viewOnce,
        Long replyToId,
        // ── v2 (Signal protocol) only ──
        Integer v,
        String clientId,                // sender-chosen id, echoed in the "sent"/"send-error" reply
        List<Envelope> envelopes        // one ciphertext per target device
) {
    /** Defensive accessor — viewOnce may be omitted from older clients. */
    public boolean viewOnceFlag() {
        return viewOnce != null && viewOnce;
    }

    public boolean isV2() {
        return v != null && v == 2;
    }

    public record Envelope(String user, Integer deviceId, Integer type, String body) { }
}

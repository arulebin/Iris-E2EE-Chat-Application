package com.iris.backend;

public record IncomingMessage(
        String to,
        String content,
        String encryptedKeyForSender,
        String encryptedKeyForRecipient,
        String mediaId,
        String mimeType,
        Boolean viewOnce
) {
    /** Defensive accessor — viewOnce may be omitted from older clients. */
    public boolean viewOnceFlag() {
        return viewOnce != null && viewOnce;
    }
}

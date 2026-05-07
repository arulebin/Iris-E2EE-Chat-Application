package com.iris.backend;

import java.time.Instant;

public record OutgoingMessage(
        String from,
        String to,
        String content,
        String encryptedKeyForSender,
        String encryptedKeyForRecipient,
        String mediaId,
        String mimeType,
        boolean viewOnce,
        Instant viewedAt,
        Instant sentAt
) {}

package com.iris.backend;

import java.time.Instant;

public record OutgoingMessage(
        Long id,
        String from,
        String to,
        String content,
        String encryptedKeyForSender,
        String encryptedKeyForRecipient,
        String mediaId,
        String mimeType,
        boolean viewOnce,
        Instant viewedAt,
        Instant sentAt,
        Long replyToId,
        Instant readAt,
        int v,                  // 1 = legacy RSA, 2 = Signal protocol (content arrives in an envelope)
        Integer senderDeviceId
) {
    static OutgoingMessage of(Message m) {
        return new OutgoingMessage(
            m.getId(),
            m.getSender(), m.getRecipient(), m.getContent(),
            m.getEncryptedKeyForSender(), m.getEncryptedKeyForRecipient(),
            m.getMediaId(), m.getMimeType(),
            m.isViewOnce(), m.getViewedAt(),
            m.getSentAt(),
            m.getReplyToId(),
            m.getReadAt(),
            m.getProtocolVersion(),
            m.getSenderDeviceId()
        );
    }
}

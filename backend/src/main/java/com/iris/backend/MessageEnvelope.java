package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * One device's copy of a v2 (Signal-protocol) message: the ciphertext only that
 * device's session can open. Deleted as soon as the device acknowledges it — after
 * the ratchet advances the server copy is undecryptable anyway, and keeping it
 * would only be a liability.
 */
@Entity
@Table(
    name = "message_envelopes",
    indexes = @Index(columnList = "targetUser, targetDeviceId")
)
public class MessageEnvelope {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long messageId;

    @Column(nullable = false, length = 64)
    private String targetUser;

    @Column(nullable = false)
    private int targetDeviceId;

    // 3 = PreKeyWhisperMessage (session-establishing), 1 = WhisperMessage.
    @Column(nullable = false)
    private int type;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String body;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected MessageEnvelope() { }

    public MessageEnvelope(Long messageId, String targetUser, int targetDeviceId, int type, String body) {
        this.messageId = messageId;
        this.targetUser = targetUser;
        this.targetDeviceId = targetDeviceId;
        this.type = type;
        this.body = body;
    }

    public Long getId() { return id; }
    public Long getMessageId() { return messageId; }
    public String getTargetUser() { return targetUser; }
    public int getTargetDeviceId() { return targetDeviceId; }
    public int getType() { return type; }
    public String getBody() { return body; }
    public Instant getCreatedAt() { return createdAt; }
}

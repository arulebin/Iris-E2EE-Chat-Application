package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "messages")
public class Message {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length=64)
    private String sender;

    // Allow empty content for media-only messages (caption is optional).
    // TEXT: a legacy (v1) RSA-hybrid ciphertext of a long message overflows varchar(4000).
    // Existing Postgres columns are widened by ColumnTypeMigrator.
    @Column(columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false, updatable = false)
    private Instant sentAt = Instant.now();

    @Column(nullable = false, length = 64)
    private String recipient;

    @Column(columnDefinition = "TEXT")
    private String encryptedKeyForSender;

    @Column(columnDefinition = "TEXT")
    private String encryptedKeyForRecipient;

    @Column(length = 36)
    private String mediaId;

    @Column(length = 100)
    private String mimeType;

    @Column(nullable = false, columnDefinition = "BOOLEAN DEFAULT FALSE NOT NULL")
    private boolean viewOnce = false;

    private Instant viewedAt;

    private Long replyToId;

    private Instant readAt;

    // null/1 = legacy: `content` is AES-GCM ciphertext with the key RSA-wrapped for
    // both parties, readable from the server forever by either account key.
    // 2 = Signal protocol: `content` is empty; per-device ciphertexts live in
    // message_envelopes until delivered, so this row is metadata only.
    private Integer protocolVersion;

    // Sending device for v2 messages — recipients need it to pick the session.
    private Integer senderDeviceId;

    protected Message(){ }

    /** Metadata row for a v2 message; the content travels in per-device envelopes. */
    static Message v2(String sender, int senderDeviceId, String recipient,
                      String mediaId, String mimeType, boolean viewOnce, Long replyToId) {
        Message m = new Message(sender, recipient, "", null, null, mediaId, mimeType, viewOnce, replyToId);
        m.protocolVersion = 2;
        m.senderDeviceId = senderDeviceId;
        return m;
    }

    public Message(String sender, String recipient, String content,
               String encryptedKeyForSender, String encryptedKeyForRecipient,
               String mediaId, String mimeType, boolean viewOnce,
               Long replyToId) {
        this.sender = sender;
        this.recipient = recipient;
        this.content = content;
        this.encryptedKeyForSender = encryptedKeyForSender;
        this.encryptedKeyForRecipient = encryptedKeyForRecipient;
        this.mediaId = mediaId;
        this.mimeType = mimeType;
        this.viewOnce = viewOnce;
        this.replyToId = replyToId;
    }


    public Long getId() { return id; }
    public String getSender() { return sender; }
    public String getContent() { return content; }
    public Instant getSentAt() { return sentAt; }
    public String getRecipient() { return recipient; }
    public String getEncryptedKeyForSender() { return encryptedKeyForSender; }
    public String getEncryptedKeyForRecipient() { return encryptedKeyForRecipient; }
    public String getMediaId() { return mediaId; }
    public String getMimeType() { return mimeType; }
    public boolean isViewOnce() { return viewOnce; }
    public Instant getViewedAt() { return viewedAt; }
    public void setViewedAt(Instant viewedAt) { this.viewedAt = viewedAt; }
    public Long getReplyToId() { return replyToId; }
    public Instant getReadAt() { return readAt; }
    public void setReadAt(Instant readAt) { this.readAt = readAt; }
    public int getProtocolVersion() { return protocolVersion == null ? 1 : protocolVersion; }
    public Integer getSenderDeviceId() { return senderDeviceId; }
}

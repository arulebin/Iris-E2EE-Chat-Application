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
    @Column(length=4000)
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

    protected Message(){ }

    public Message(String sender, String recipient, String content,
               String encryptedKeyForSender, String encryptedKeyForRecipient,
               String mediaId, String mimeType, boolean viewOnce) {
        this.sender = sender;
        this.recipient = recipient;
        this.content = content;
        this.encryptedKeyForSender = encryptedKeyForSender;
        this.encryptedKeyForRecipient = encryptedKeyForRecipient;
        this.mediaId = mediaId;
        this.mimeType = mimeType;
        this.viewOnce = viewOnce;
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
}

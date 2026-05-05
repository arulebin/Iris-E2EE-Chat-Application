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
    
    @Column(nullable= false, length=4000)
    private String content;

    @Column(nullable = false, updatable = false)
    private Instant sentAt = Instant.now();

    @Column(nullable = false, length = 64)
    private String recipient;

    @Column(columnDefinition = "TEXT")
    private String encryptedKeyForSender;

    @Column(columnDefinition = "TEXT")
    private String encryptedKeyForRecipient;

    protected Message(){ }

    public Message(String sender, String recipient, String content,
               String encryptedKeyForSender, String encryptedKeyForRecipient) {
        this.sender = sender;
        this.recipient = recipient;
        this.content = content;
        this.encryptedKeyForSender = encryptedKeyForSender;
        this.encryptedKeyForRecipient = encryptedKeyForRecipient;
    }


    public Long getId() { return id; }
    public String getSender() { return sender; }
    public String getContent() { return content; }
    public Instant getSentAt() { return sentAt; }
    public String getRecipient() { return recipient; }
    public String getEncryptedKeyForSender() { return encryptedKeyForSender; }
    public String getEncryptedKeyForRecipient() { return encryptedKeyForRecipient; }
}

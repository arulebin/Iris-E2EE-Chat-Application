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

    protected Message(){ }

    public Message(String sender, String content){
        this.sender=sender;
        this.content= content;
    }

    public Long getId() { return id; }
    public String getSender() { return sender; }
    public String getContent() { return content; }
    public Instant getSentAt() { return sentAt; }
}

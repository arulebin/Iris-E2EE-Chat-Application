package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

/** One Android device's Firebase Cloud Messaging registration token. */
@Entity
@Table(name = "fcm_tokens")
public class FcmToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String username;

    // FCM tokens are ~160 chars today but Google doesn't promise a max length.
    @Column(nullable = false, length = 4096, unique = true)
    private String token;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected FcmToken() { }

    public FcmToken(String username, String token) {
        this.username = username;
        this.token = token;
    }

    public Long getId() { return id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getToken() { return token; }
    public Instant getCreatedAt() { return createdAt; }
}

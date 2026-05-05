package com.iris.backend;

import jakarta.persistence.*;

@Entity
@Table(name = "push_subscriptions")
public class PushSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String username;

    // Push endpoints can be quite long URLs, so use TEXT
    @Column(nullable = false, columnDefinition = "TEXT", unique = true)
    private String endpoint;

    @Column(nullable = false, length = 200)
    private String p256dh;

    @Column(nullable = false, length = 50)
    private String auth;

    protected PushSubscription() { }

    public PushSubscription(String username, String endpoint, String p256dh, String auth) {
        this.username = username;
        this.endpoint = endpoint;
        this.p256dh   = p256dh;
        this.auth     = auth;
    }

    public Long getId() { return id; }
    public String getUsername() { return username; }
    public String getEndpoint() { return endpoint; }
    public String getP256dh() { return p256dh; }
    public String getAuth() { return auth; }
}

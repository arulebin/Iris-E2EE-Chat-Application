package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "users")  // 'user' is a reserved keyword in many SQL dialects, including Postgres — avoid it as a table name
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    @Column(nullable = false)
    private String passwordHash;   // never stores plaintext — we'll hash with BCrypt next step

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    // JPA requires a no-arg constructor (reflection)
    protected User() { }

    public User(String username, String passwordHash) {
        this.username = username;
        this.passwordHash = passwordHash;
    }

    // Getters (JPA can use field access, but other code needs these)
    public Long getId() { return id; }
    public String getUsername() { return username; }
    public String getPasswordHash() { return passwordHash; }
    public Instant getCreatedAt() { return createdAt; }
}

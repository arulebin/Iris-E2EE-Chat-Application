package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

// One user blocking another. Directional: `blocker` no longer receives anything
// from `blocked`, and neither side can message or call the other while it exists.
@Entity
@Table(name = "user_blocks",
       uniqueConstraints = @UniqueConstraint(columnNames = {"blocker", "blocked"}))
public class UserBlock {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String blocker;

    @Column(nullable = false, length = 64)
    private String blocked;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected UserBlock() {}

    public UserBlock(String blocker, String blocked) {
        this.blocker = blocker;
        this.blocked = blocked;
    }

    public Long getId() { return id; }
    public String getBlocker() { return blocker; }
    public String getBlocked() { return blocked; }
    public Instant getCreatedAt() { return createdAt; }
}

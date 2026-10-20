package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * One link in a refresh-token chain. Every refresh rotates the token: the
 * presented row is revoked (reason ROTATED) and a successor is issued in the same
 * {@code familyId}. Presenting an already-rotated token outside the short race
 * window means it was copied, so the whole family is revoked.
 *
 * Like WhatsApp, a login never expires by time: it ends only on logout, device
 * removal, a credential change, or detected token reuse.
 *
 * Only a SHA-256 of the token is stored — a database leak can't be replayed.
 */
@Entity
@Table(
    name = "refresh_sessions",
    indexes = {
        @Index(columnList = "familyId"),
        @Index(columnList = "username, deviceId"),
        @Index(columnList = "revokedAt")
    }
)
public class RefreshSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String username;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(nullable = false, length = 36)
    private String familyId;

    // Signal device this login belongs to, once the client reports it. Removing the
    // device revokes its sessions, so a removed device is also logged out.
    private Integer deviceId;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    private Instant revokedAt;

    @Column(length = 16)
    private String revokeReason;

    protected RefreshSession() { }

    public RefreshSession(String username, String tokenHash, String familyId, Integer deviceId) {
        this.username = username;
        this.tokenHash = tokenHash;
        this.familyId = familyId;
        this.deviceId = deviceId;
    }

    public Long getId() { return id; }
    public String getUsername() { return username; }
    public String getTokenHash() { return tokenHash; }
    public String getFamilyId() { return familyId; }
    public Integer getDeviceId() { return deviceId; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public String getRevokeReason() { return revokeReason; }

    public void revoke(Instant at, String reason) {
        if (revokedAt != null) return;
        this.revokedAt = at;
        this.revokeReason = reason;
    }
}

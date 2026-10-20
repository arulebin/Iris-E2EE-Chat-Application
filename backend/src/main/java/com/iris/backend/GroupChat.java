package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * A group conversation. Message content never touches the server (each group
 * message is fanned out by the sender as per-device Signal envelopes), but the
 * group's name, avatar and member list ARE server-visible here.
 *
 * Tradeoff, deliberately accepted for v1: Signal hides group metadata behind
 * encrypted group state + anonymous credentials (zkgroup). Doing that properly is
 * a project of its own; until then a compromised server learns who is in which
 * group and what it's called — not what anyone says.
 */
@Entity
@Table(name = "chat_groups")
public class GroupChat {

    @Id
    @Column(length = 36)
    private String id;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(length = 120)
    private String avatarUrl;

    @Column(nullable = false, length = 64)
    private String createdBy;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    // Random join token; null = invite link disabled. Admins can reset it at any time.
    @Column(unique = true, length = 43)
    private String inviteToken;

    protected GroupChat() { }

    public GroupChat(String id, String name, String createdBy) {
        this.id = id;
        this.name = name;
        this.createdBy = createdBy;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
    public String getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public String getInviteToken() { return inviteToken; }
    public void setInviteToken(String inviteToken) { this.inviteToken = inviteToken; }
}

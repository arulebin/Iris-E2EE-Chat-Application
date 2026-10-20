package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "chat_group_members",
       uniqueConstraints = @UniqueConstraint(columnNames = {"group_id", "username"}),
       indexes = @Index(columnList = "username"))
public class GroupMember {

    public enum Role { ADMIN, MEMBER }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "group_id", nullable = false, length = 36)
    private String groupId;

    @Column(nullable = false, length = 64)
    private String username;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Role role = Role.MEMBER;

    @Column(nullable = false, updatable = false)
    private Instant joinedAt = Instant.now();

    // Latest time this member had the group open — drives "seen by" receipts.
    private Instant lastReadAt;

    protected GroupMember() { }

    public GroupMember(String groupId, String username, Role role) {
        this.groupId = groupId;
        this.username = username;
        this.role = role;
    }

    public Long getId() { return id; }
    public String getGroupId() { return groupId; }
    public String getUsername() { return username; }
    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }
    public Instant getJoinedAt() { return joinedAt; }
    public Instant getLastReadAt() { return lastReadAt; }
    public void setLastReadAt(Instant lastReadAt) { this.lastReadAt = lastReadAt; }
    public boolean isAdmin() { return role == Role.ADMIN; }
}

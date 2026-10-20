package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * Membership/metadata change in a group ("X added Y", "X renamed the group").
 * Server-generated from facts the server already knows, and shown to members as
 * system lines in the conversation. Never carries message content.
 */
@Entity
@Table(name = "chat_group_events", indexes = @Index(columnList = "group_id"))
public class GroupEvent {

    public enum Type { CREATED, ADDED, REMOVED, LEFT, JOINED, RENAMED, AVATAR, PROMOTED, DEMOTED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "group_id", nullable = false, length = 36)
    private String groupId;

    @Column(nullable = false, length = 64)
    private String actor;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Type type;

    @Column(length = 64)
    private String target;

    // e.g. the new group name for RENAMED
    @Column(length = 64)
    private String detail;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected GroupEvent() { }

    public GroupEvent(String groupId, String actor, Type type, String target, String detail) {
        this.groupId = groupId;
        this.actor = actor;
        this.type = type;
        this.target = target;
        this.detail = detail;
    }

    public Long getId() { return id; }
    public String getGroupId() { return groupId; }
    public String getActor() { return actor; }
    public Type getType() { return type; }
    public String getTarget() { return target; }
    public String getDetail() { return detail; }
    public Instant getCreatedAt() { return createdAt; }
}

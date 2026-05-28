package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "friend_requests",
       uniqueConstraints = @UniqueConstraint(columnNames = {"from_user", "to_user"}))
public class FriendRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "from_user", nullable = false)
    private String fromUser;

    @Column(name = "to_user", nullable = false)
    private String toUser;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.PENDING;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public enum Status { PENDING, ACCEPTED, REJECTED }

    protected FriendRequest() {}

    public FriendRequest(String fromUser, String toUser) {
        this.fromUser = fromUser;
        this.toUser   = toUser;
    }

    public Long getId()         { return id; }
    public String getFromUser() { return fromUser; }
    public String getToUser()   { return toUser; }
    public Status getStatus()   { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public void setStatus(Status status) { this.status = status; }
}

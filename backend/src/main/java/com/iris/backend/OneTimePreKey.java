package com.iris.backend;

import jakarta.persistence.*;

/** A single-use X3DH prekey. Handed out at most once, then deleted. */
@Entity
@Table(
    name = "one_time_prekeys",
    uniqueConstraints = @UniqueConstraint(columnNames = {"username", "deviceId", "keyId"}),
    indexes = @Index(columnList = "username, deviceId")
)
public class OneTimePreKey {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String username;

    @Column(nullable = false)
    private int deviceId;

    @Column(nullable = false)
    private int keyId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String publicKey;

    protected OneTimePreKey() { }

    public OneTimePreKey(String username, int deviceId, int keyId, String publicKey) {
        this.username = username;
        this.deviceId = deviceId;
        this.keyId = keyId;
        this.publicKey = publicKey;
    }

    public Long getId() { return id; }
    public String getUsername() { return username; }
    public int getDeviceId() { return deviceId; }
    public int getKeyId() { return keyId; }
    public String getPublicKey() { return publicKey; }
}

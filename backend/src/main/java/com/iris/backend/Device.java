package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * One installation of Iris (a browser profile or the Android app) registered for
 * Signal-protocol messaging. Each device has its own sessions and prekeys; the
 * identity key is per ACCOUNT and lives on {@link User}.
 */
@Entity
@Table(
    name = "devices",
    uniqueConstraints = @UniqueConstraint(columnNames = {"username", "deviceId"})
)
public class Device {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String username;

    @Column(nullable = false)
    private int deviceId;

    @Column(nullable = false)
    private int registrationId;

    // Current signed prekey (medium-term, rotated by the client).
    @Column(nullable = false)
    private int signedPreKeyId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String signedPreKey;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String signedPreKeySignature;

    @Column(length = 64)
    private String label;

    /**
     * Install-stable, per-account device key sent by the mobile app: hex HMAC-SHA256(key = username,
     * message = Android's ANDROID_ID). ANDROID_ID survives an uninstall + reinstall of the same signed app,
     * so a re-registration from the same phone carries the same key and replaces its dead predecessor.
     * Keyed by the username, so the server can't link one phone across accounts. NULL for web devices and
     * for app builds that predate the field.
     */
    @Column(length = 64)
    private String installKey;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant lastSeen = Instant.now();

    protected Device() { }

    public Device(String username, int deviceId, int registrationId,
                  int signedPreKeyId, String signedPreKey, String signedPreKeySignature, String label) {
        this.username = username;
        this.deviceId = deviceId;
        this.registrationId = registrationId;
        this.signedPreKeyId = signedPreKeyId;
        this.signedPreKey = signedPreKey;
        this.signedPreKeySignature = signedPreKeySignature;
        this.label = label;
    }

    public Long getId() { return id; }
    public String getUsername() { return username; }
    public int getDeviceId() { return deviceId; }
    public int getRegistrationId() { return registrationId; }
    public int getSignedPreKeyId() { return signedPreKeyId; }
    public String getSignedPreKey() { return signedPreKey; }
    public String getSignedPreKeySignature() { return signedPreKeySignature; }
    public String getLabel() { return label; }
    public String getInstallKey() { return installKey; }
    public void setInstallKey(String installKey) { this.installKey = installKey; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getLastSeen() { return lastSeen; }
    public void setLastSeen(Instant lastSeen) { this.lastSeen = lastSeen; }

    public void rotateSignedPreKey(int keyId, String publicKey, String signature) {
        this.signedPreKeyId = keyId;
        this.signedPreKey = publicKey;
        this.signedPreKeySignature = signature;
    }
}

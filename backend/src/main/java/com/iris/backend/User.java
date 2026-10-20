package com.iris.backend;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")  // 'user' is a reserved keyword in many SQL dialects, including Postgres — avoid it as a table name
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, length = 36)
    private String shareId = UUID.randomUUID().toString();

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    @Column(nullable = false)
    private String passwordHash;   // v1: bcrypt(rawPassword). v2: bcrypt(authKey) — the server never sees the password

    // Salt for the client-side PBKDF2 that splits the password into authKey + KEK.
    // Null for v1 (legacy) accounts.
    @Column(length = 64)
    private String authSalt;

    // 1 = legacy (raw password sent to server, privkey wrapped under PBKDF2(password)).
    // 2 = client-derived authKey; privkey wrapped under an HKDF-derived KEK the server can't reproduce.
    // Nullable so ddl-auto=update can add the column to existing rows; null reads as 1.
    @Column
    private Integer credentialVersion;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(columnDefinition = "TEXT")
    private String publicKey;

    @Column(columnDefinition = "TEXT")
    private String encryptedPrivateKey;

    @Column(columnDefinition = "TEXT")
    private String keySalt;

    // ── Signal-protocol account identity (shared by all of the user's devices) ──
    // Curve25519 public key, base64 (33 bytes incl. the 0x05 type prefix).
    @Column(columnDefinition = "TEXT")
    private String identityKey;

    // Identity private key wrapped under the client's HKDF KEK (same scheme as
    // encryptedPrivateKey) — lets a new device of the SAME account recover it.
    @Column(columnDefinition = "TEXT")
    private String encryptedIdentityKey;

    @Column(length = 64)
    private String identityKeySalt;

    // identityKey signed with the legacy RSA key (RSA-PSS). Lets contacts that had
    // pinned the RSA key move their pin to the identity key without a "key changed".
    @Column(columnDefinition = "TEXT")
    private String identityCrossSignature;

    // Device ids are never reused, so stale sessions can't be confused with a new device.
    @Column
    private Integer nextDeviceId;

    @Column
    private String preferredName;

    @Column(columnDefinition = "TEXT")
    private String avatarUrl;

    // JPA requires a no-arg constructor (reflection)
    protected User() { }

    public User(String username, String passwordHash) {
        this.username = username;
        this.passwordHash = passwordHash;
    }

    // Getters (JPA can use field access, but other code needs these)
    public Long getId() { return id; }
    public String getShareId() { return shareId; }
    public String getUsername() { return username; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public String getAuthSalt() { return authSalt; }
    public void setAuthSalt(String authSalt) { this.authSalt = authSalt; }
    public int getCredentialVersion() { return credentialVersion == null ? 1 : credentialVersion; }
    public void setCredentialVersion(int credentialVersion) { this.credentialVersion = credentialVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public String getPublicKey() { return publicKey; }
    public void setPublicKey(String publicKey) { this.publicKey = publicKey; }
    public String getEncryptedPrivateKey() { return encryptedPrivateKey; }
    public void setEncryptedPrivateKey(String encryptedPrivateKey) { this.encryptedPrivateKey = encryptedPrivateKey; }
    public String getKeySalt() { return keySalt; }
    public void setKeySalt(String keySalt) { this.keySalt = keySalt; }
    public String getIdentityKey() { return identityKey; }
    public void setIdentityKey(String identityKey) { this.identityKey = identityKey; }
    public String getEncryptedIdentityKey() { return encryptedIdentityKey; }
    public void setEncryptedIdentityKey(String encryptedIdentityKey) { this.encryptedIdentityKey = encryptedIdentityKey; }
    public String getIdentityKeySalt() { return identityKeySalt; }
    public void setIdentityKeySalt(String identityKeySalt) { this.identityKeySalt = identityKeySalt; }
    public String getIdentityCrossSignature() { return identityCrossSignature; }
    public void setIdentityCrossSignature(String identityCrossSignature) { this.identityCrossSignature = identityCrossSignature; }
    /** Hands out the next device id (1, 2, 3, …) and advances the counter. */
    public int allocateDeviceId() {
        int id = nextDeviceId == null ? 1 : nextDeviceId;
        nextDeviceId = id + 1;
        return id;
    }
    public String getPreferredName() { return preferredName; }
    public void setPreferredName(String preferredName) { this.preferredName = preferredName; }
    public String getAvatarUrl() { return avatarUrl; }
    public void setAvatarUrl(String avatarUrl) { this.avatarUrl = avatarUrl; }
}

package com.iris.backend;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/**
 * Long-lived logins without long-lived bearer tokens. The access JWT stays short
 * (jwt.expiration-ms, 1 h); the client trades a rotating refresh token for a new
 * one. Refresh tokens are opaque random strings, stored only as SHA-256 hashes,
 * and revocable per login (logout), per device (device removal) or per family
 * (reuse of a rotated token = theft).
 */
@Service
public class SessionService {

    static final String ROTATED = "ROTATED";
    static final String LOGOUT = "LOGOUT";
    static final String REUSE = "REUSE";

    // Two tabs (or a retry after a dropped response) can present the same token
    // moments apart. Inside this window that's a benign race, not theft.
    static final Duration ROTATION_GRACE = Duration.ofSeconds(20);

    private final RefreshSessionRepository sessions;
    private final DeviceRepository devices;
    private final Duration ttl;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public SessionService(RefreshSessionRepository sessions, DeviceRepository devices,
                          @Value("${auth.refresh-ttl-days:30}") long ttlDays) {
        this(sessions, devices, Duration.ofDays(ttlDays), Clock.systemUTC());
    }

    SessionService(RefreshSessionRepository sessions, DeviceRepository devices, Duration ttl, Clock clock) {
        this.sessions = sessions;
        this.devices = devices;
        this.ttl = ttl;
        this.clock = clock;
    }

    /** New login: starts a fresh token family. */
    @Transactional
    public String issue(String username) {
        return create(username, UUID.randomUUID().toString(), null);
    }

    /**
     * Rotates a refresh token. Throws {@link InvalidRefreshException} (→ 401, log in
     * again) or {@link RefreshRaceException} (→ 409, another tab just rotated it;
     * re-read the stored token and retry).
     */
    @Transactional
    public Rotated rotate(String token, Integer deviceId) {
        if (token == null || token.isBlank()) throw new InvalidRefreshException();
        Instant now = clock.instant();
        RefreshSession current = sessions.findForUpdate(hash(token)).orElseThrow(InvalidRefreshException::new);

        if (current.getRevokedAt() != null) {
            boolean justRotated = ROTATED.equals(current.getRevokeReason())
                    && current.getRevokedAt().isAfter(now.minus(ROTATION_GRACE));
            if (justRotated) throw new RefreshRaceException();
            // A rotated token came back long after it was replaced: someone else has a copy.
            if (ROTATED.equals(current.getRevokeReason())) sessions.revokeFamily(current.getFamilyId(), now, REUSE);
            throw new InvalidRefreshException();
        }
        if (!current.getExpiresAt().isAfter(now)) throw new InvalidRefreshException();

        // Bind the login to its Signal device the first time the client reports it,
        // so removing that device also ends this login.
        Integer boundDevice = current.getDeviceId();
        if (boundDevice == null && deviceId != null
                && devices.existsByUsernameAndDeviceId(current.getUsername(), deviceId)) {
            boundDevice = deviceId;
        }

        current.revoke(now, ROTATED);
        sessions.save(current);
        String next = create(current.getUsername(), current.getFamilyId(), boundDevice);
        return new Rotated(current.getUsername(), next);
    }

    /** Logout: ends this login (the whole family), not the account's other devices. */
    @Transactional
    public void revoke(String token) {
        if (token == null || token.isBlank()) return;
        sessions.findForUpdate(hash(token))
                .ifPresent(s -> sessions.revokeFamily(s.getFamilyId(), clock.instant(), LOGOUT));
    }

    @Transactional
    public void revokeDevice(String username, int deviceId) {
        sessions.revokeDevice(username, deviceId, clock.instant());
    }

    // Expired rows are useless (even for reuse detection — the token is dead anyway).
    @Scheduled(fixedDelayString = "PT6H", initialDelayString = "PT5M")
    @Transactional
    public void purgeExpired() {
        sessions.deleteExpiredBefore(clock.instant().minus(Duration.ofDays(1)));
    }

    private String create(String username, String familyId, Integer deviceId) {
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        sessions.save(new RefreshSession(username, hash(token), familyId, deviceId, clock.instant().plus(ttl)));
        return token;
    }

    static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public record Rotated(String username, String refreshToken) { }

    public static class InvalidRefreshException extends RuntimeException {
        public InvalidRefreshException() { super("Session expired — log in again"); }
    }

    public static class RefreshRaceException extends RuntimeException {
        public RefreshRaceException() { super("Refresh token was just rotated"); }
    }
}

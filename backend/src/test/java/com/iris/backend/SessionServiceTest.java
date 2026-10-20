package com.iris.backend;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SessionServiceTest {

    private final List<RefreshSession> rows = new ArrayList<>();
    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    private boolean deviceExists = true;
    private SessionService service;

    @BeforeEach
    void setUp() {
        rows.clear();
        service = new SessionService(fakeSessions(), fakeDevices(), clock);
    }

    @Test
    void rotationIssuesNewTokenAndRetiresOld() {
        String t1 = service.issue("alice");
        SessionService.Rotated r = service.rotate(t1, null);
        assertEquals("alice", r.username());
        assertNotEquals(t1, r.refreshToken());
        // The new token works; the old one is retired.
        assertDoesNotThrow(() -> service.rotate(r.refreshToken(), null));
    }

    @Test
    void storesOnlyHashes() {
        String t = service.issue("alice");
        assertTrue(rows.stream().noneMatch(s -> s.getTokenHash().equals(t)));
        assertEquals(SessionService.hash(t), rows.get(0).getTokenHash());
    }

    @Test
    void reuseInsideGraceIsARaceNotTheft() {
        String t1 = service.issue("alice");
        String t2 = service.rotate(t1, null).refreshToken();
        clock.advance(Duration.ofSeconds(5));
        assertThrows(SessionService.RefreshRaceException.class, () -> service.rotate(t1, null));
        // The family survives: the legitimate successor still works.
        assertDoesNotThrow(() -> service.rotate(t2, null));
    }

    @Test
    void reuseAfterGraceRevokesWholeFamily() {
        String t1 = service.issue("alice");
        String t2 = service.rotate(t1, null).refreshToken();
        clock.advance(Duration.ofMinutes(5));
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate(t1, null));
        // The thief's copy and the victim's current token are both dead now.
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate(t2, null));
    }

    @Test
    void loginNeverExpiresByTime() {
        String t = service.issue("alice");
        clock.advance(Duration.ofDays(3 * 365));   // offline for years
        String t2 = assertDoesNotThrow(() -> service.rotate(t, null).refreshToken());
        clock.advance(Duration.ofDays(400));
        assertDoesNotThrow(() -> service.rotate(t2, null));
    }

    @Test
    void credentialChangeEndsEveryLoginButReissuesTheCaller() {
        String phone = service.issue("alice");
        String laptop = service.issue("alice");
        String bob = service.issue("bob");
        String fresh = service.revokeAllAndReissue("alice");
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate(phone, null));
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate(laptop, null));
        assertDoesNotThrow(() -> service.rotate(fresh, null));   // the upgrading device stays in
        assertDoesNotThrow(() -> service.rotate(bob, null));     // other accounts untouched
    }

    @Test
    void purgeKeepsLiveSessionsAndDropsOldRevokedRows() {
        String idle = service.issue("alice");                    // never refreshed, still live
        String t1 = service.issue("bob");
        service.rotate(t1, null);                                // t1 is now a revoked row
        clock.advance(SessionService.REVOKED_RETENTION.plusDays(1));
        service.purgeRevoked();
        assertTrue(rows.stream().allMatch(s -> s.getRevokedAt() == null));
        assertEquals(2, rows.size());                            // alice's + bob's successor
        assertDoesNotThrow(() -> service.rotate(idle, null));
    }

    @Test
    void unknownOrBlankTokenIsRejected() {
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate("nope", null));
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate("", null));
    }

    @Test
    void logoutEndsTheFamily() {
        String t1 = service.issue("alice");
        String t2 = service.rotate(t1, null).refreshToken();
        service.revoke(t2);
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate(t2, null));
    }

    @Test
    void logoutOfOneLoginLeavesOtherLoginsAlone() {
        String phone = service.issue("alice");
        String laptop = service.issue("alice");
        service.revoke(phone);
        assertDoesNotThrow(() -> service.rotate(laptop, null));
    }

    @Test
    void deviceRemovalRevokesBoundSessions() {
        String t1 = service.issue("alice");
        String t2 = service.rotate(t1, 2).refreshToken();     // binds to device 2
        String other = service.issue("alice");
        String other2 = service.rotate(other, 3).refreshToken();
        service.revokeDevice("alice", 2);
        assertThrows(SessionService.InvalidRefreshException.class, () -> service.rotate(t2, null));
        assertDoesNotThrow(() -> service.rotate(other2, null));
    }

    @Test
    void unknownDeviceIsNotBound() {
        deviceExists = false;
        String t1 = service.issue("alice");
        String t2 = service.rotate(t1, 9).refreshToken();
        service.revokeDevice("alice", 9);
        assertDoesNotThrow(() -> service.rotate(t2, null));
    }

    // ── fakes ────────────────────────────────────────────────────────────

    private RefreshSessionRepository fakeSessions() {
        return (RefreshSessionRepository) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {RefreshSessionRepository.class},
            (proxy, method, args) -> switch (method.getName()) {
                case "save" -> { RefreshSession s = (RefreshSession) args[0]; if (!rows.contains(s)) rows.add(s); yield s; }
                case "findForUpdate" -> rows.stream().filter(s -> s.getTokenHash().equals(args[0])).findFirst();
                case "revokeFamily" -> {
                    int n = 0;
                    for (RefreshSession s : rows) if (s.getFamilyId().equals(args[0]) && s.getRevokedAt() == null) { s.revoke((Instant) args[1], (String) args[2]); n++; }
                    yield n;
                }
                case "revokeDevice" -> {
                    int n = 0;
                    for (RefreshSession s : rows)
                        if (s.getUsername().equals(args[0]) && Integer.valueOf((int) args[1]).equals(s.getDeviceId()) && s.getRevokedAt() == null) { s.revoke((Instant) args[2], "DEVICE"); n++; }
                    yield n;
                }
                case "revokeAllForUser" -> {
                    int n = 0;
                    for (RefreshSession s : rows) if (s.getUsername().equals(args[0]) && s.getRevokedAt() == null) { s.revoke((Instant) args[1], (String) args[2]); n++; }
                    yield n;
                }
                case "deleteRevokedBefore" -> {
                    int before = rows.size();
                    rows.removeIf(s -> s.getRevokedAt() != null && s.getRevokedAt().isBefore((Instant) args[0]));
                    yield before - rows.size();
                }
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                case "toString" -> "FakeRefreshSessionRepository";
                default -> throw new UnsupportedOperationException(method.getName());
            });
    }

    private DeviceRepository fakeDevices() {
        return (DeviceRepository) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {DeviceRepository.class},
            (proxy, method, args) -> switch (method.getName()) {
                case "existsByUsernameAndDeviceId" -> deviceExists;
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                case "toString" -> "FakeDeviceRepository";
                default -> throw new UnsupportedOperationException(method.getName());
            });
    }

    private static final class MutableClock extends Clock {
        private Instant now;
        MutableClock(Instant now) { this.now = now; }
        void advance(Duration d) { now = now.plus(d); }
        @Override public Instant instant() { return now; }
        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
    }
}

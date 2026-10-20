package com.iris.backend;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Same-phone replacement, the one-time install-key claim, and the inactivity prune (H2, full context). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class DeviceCleanupTest {

    @Autowired UserRepository users;
    @Autowired DeviceRepository devices;
    @Autowired OneTimePreKeyRepository preKeys;
    @Autowired FcmTokenRepository fcmTokens;
    @Autowired SignalKeyService keys;
    @Autowired DeviceCleanupService cleanup;

    private static final String KEY_A = "a".repeat(64);
    private static final String KEY_B = "b".repeat(64);
    private static final String PHONE = "CPH2423 (Iris Android)";

    private String user;

    private static String b64(int n) {
        byte[] b = new byte[n];
        b[0] = 5;
        return Base64.getEncoder().encodeToString(b);
    }

    @BeforeEach
    void setUp() {
        user = "u" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        User u = new User(user, "x");
        u.setIdentityKey(b64(33));
        users.save(u);
    }

    private int register(String label, String installKey) {
        var spk = new SignalKeyService.SignedPreKeyDto(1, b64(33), b64(64));
        var pk = List.of(new SignalKeyService.PreKeyDto(7, b64(33)));
        cleanup.retireSameInstall(user, installKey);
        return keys.registerDevice(user, new SignalKeyService.DeviceRegistration(1234, label, spk, pk, installKey));
    }

    private void seen(int deviceId, Instant when) {
        Device d = devices.findByUsernameAndDeviceId(user, deviceId).orElseThrow();
        d.setLastSeen(when);
        devices.save(d);
    }

    private List<Integer> ids() {
        return keys.deviceIds(user);
    }

    private void fcm(int deviceId) {
        FcmToken t = new FcmToken(user, "tok-" + user + "-" + deviceId);
        t.setDeviceId(deviceId);
        fcmTokens.save(t);
    }

    @Test
    void reinstallWithSameInstallKeyReplacesTheOldDevice() {
        int old = register(PHONE, KEY_A);
        fcm(old);
        int web = register("Chrome on Windows", null);
        int fresh = register(PHONE, KEY_A);

        assertEquals(List.of(web, fresh), ids());
        assertEquals(0, preKeys.countByUsernameAndDeviceId(user, old));
        assertTrue(fcmTokens.findByUsername(user).stream().noneMatch(t -> Integer.valueOf(old).equals(t.getDeviceId())));
    }

    @Test
    void differentInstallKeysAreDifferentPhones() {
        int a = register(PHONE, KEY_A);
        int b = register(PHONE, KEY_B);
        assertEquals(List.of(a, b), ids());
    }

    @Test
    void reinstallFreesASlotAtTheDeviceLimit() {
        register(PHONE, KEY_A);
        for (int i = 1; i < SignalKeyService.MAX_DEVICES_PER_USER; i++) register("Browser " + i, null);
        assertEquals(SignalKeyService.MAX_DEVICES_PER_USER, ids().size());
        assertDoesNotThrow(() -> register(PHONE, KEY_A));
        assertEquals(SignalKeyService.MAX_DEVICES_PER_USER, ids().size());
    }

    @Test
    void claimRetiresTheKeylessDeadPredecessorOnTheSamePhone() {
        // Old build: no install key. The phone was reinstalled; the old install was last seen before that.
        int dead = register(PHONE, null);
        seen(dead, Instant.now().minus(Duration.ofHours(3)));
        fcm(dead);
        int live = register(PHONE, null);
        int laptop = register("Firefox on Linux", null);

        List<Integer> removed = cleanup.claim(user, live, KEY_A);

        assertEquals(List.of(dead), removed);
        assertEquals(List.of(live, laptop), ids());
        assertEquals(KEY_A, devices.findByUsernameAndDeviceId(user, live).orElseThrow().getInstallKey());
        assertTrue(fcmTokens.findByUsername(user).isEmpty());
        // Idempotent.
        assertEquals(List.of(), cleanup.claim(user, live, KEY_A));
    }

    @Test
    void claimKeepsASameModelPhoneThatIsStillInUse() {
        int other = register(PHONE, null);
        int live = register(PHONE, null);
        seen(other, Instant.now().plus(Duration.ofMinutes(1)));   // active after `live` registered
        assertEquals(List.of(), cleanup.claim(user, live, KEY_A));
        assertEquals(List.of(other, live), ids());
    }

    @Test
    void claimNeverTouchesNewerOrKeyedDevicesOrOtherModels() {
        int otherModel = register("Pixel 8 (Iris Android)", null);
        seen(otherModel, Instant.now().minus(Duration.ofDays(2)));
        int keyed = register(PHONE, KEY_B);
        seen(keyed, Instant.now().minus(Duration.ofDays(2)));
        int live = register(PHONE, null);
        assertEquals(List.of(), cleanup.claim(user, live, KEY_A));
        assertEquals(3, ids().size());
    }

    @Test
    void claimRejectsAnotherUsersDeviceAndBadKeys() {
        int live = register(PHONE, null);
        assertNull(cleanup.claim(user, live + 100, KEY_A));
        assertThrows(IllegalArgumentException.class, () -> cleanup.claim(user, live, "not-hex"));
    }

    @Test
    void pruneRemovesIdleDevicesButKeepsTheFreshestOne() {
        Instant now = Instant.now();
        int idle = register("Chrome on Windows", null);
        seen(idle, now.minus(Duration.ofDays(45)));
        int active = register(PHONE, KEY_A);
        seen(active, now.minus(Duration.ofHours(1)));

        cleanup.pruneInactive(now);
        assertEquals(List.of(active), ids());
    }

    @Test
    void pruneNeverRemovesAnAccountsOnlyOrFreshestDevice() {
        Instant now = Instant.now();
        int older = register("Chrome on Windows", null);
        seen(older, now.minus(Duration.ofDays(90)));
        int newer = register(PHONE, KEY_A);
        seen(newer, now.minus(Duration.ofDays(40)));   // also idle, but the account's freshest

        cleanup.pruneInactive(now);
        assertEquals(List.of(newer), ids());
        cleanup.pruneInactive(now);
        assertEquals(List.of(newer), ids());
    }

    @Test
    void installKeyIsValidated() {
        assertThrows(IllegalArgumentException.class, () -> register(PHONE, "ABC"));
        assertNull(SignalKeyService.validInstallKey(null));
    }
}

package com.iris.backend;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Retires Signal devices that will never come back, so they stop collecting a fan-out copy of every message,
 * holding a device slot and an FCM token:
 *
 * <ul>
 *   <li><b>Same-phone replacement</b>: the app sends an install-stable key (HMAC of ANDROID_ID under the
 *       username). A new registration — or an already-registered device "claiming" its key once — removes
 *       every other device of the account with that key: it is the same phone, reinstalled.</li>
 *   <li><b>Pre-key devices</b>: devices registered by builds that sent no key can't be matched exactly. When a
 *       device claims its key, an OLDER keyless Android-app device with the same model label that has not
 *       been seen since this device was created is treated as its dead predecessor (the old install was
 *       uninstalled: it can never be seen again after the reinstall registered).</li>
 *   <li><b>Inactivity</b>: a device not seen for {@code iris.devices.stale-days} (30) is pruned — but never the
 *       account's most recently seen device, so a user away for a month stays reachable and keeps the
 *       messages queued for them. (Signal unlinks idle linked devices but keeps the primary; here any device
 *       can be the "primary", so the freshest one is kept.)</li>
 * </ul>
 *
 * Removal is the same as the user removing a device by hand: prekeys, queued envelopes, the device row,
 * its FCM tokens, its open sockets ("device-revoked") and its logins. Senders learn of it through the
 * normal device-mismatch → forget-session path on their next message.
 */
@Service
public class DeviceCleanupService {

    private static final Logger log = LoggerFactory.getLogger(DeviceCleanupService.class);
    /** Label suffix the Android app gives its devices (`<model> (Iris Android)`). */
    static final String ANDROID_LABEL_SUFFIX = "(Iris Android)";

    private final DeviceRepository devices;
    private final SignalKeyService keys;
    private final FcmTokenRepository fcmTokens;
    private final ChatWebSocketHandler chatHandler;
    private final SessionService sessions;
    private final Duration staleAfter;
    private final Clock clock;

    public DeviceCleanupService(DeviceRepository devices, SignalKeyService keys, FcmTokenRepository fcmTokens,
                                ChatWebSocketHandler chatHandler, SessionService sessions,
                                @Value("${iris.devices.stale-days:30}") long staleDays) {
        this.devices = devices;
        this.keys = keys;
        this.fcmTokens = fcmTokens;
        this.chatHandler = chatHandler;
        this.sessions = sessions;
        this.staleAfter = Duration.ofDays(staleDays);
        this.clock = Clock.systemUTC();
    }

    /** Remove one device and everything that hangs off it. False if it didn't exist. */
    public boolean retire(String username, int deviceId) {
        if (!keys.removeDevice(username, deviceId)) return false;
        fcmTokens.deleteForDevice(username, deviceId);
        keys.forgetTouch(username, deviceId);
        chatHandler.revokeDevice(username, deviceId);
        // Its refresh tokens die with it: the removed device is logged out once its
        // current access token (≤ 1 h) expires.
        sessions.revokeDevice(username, deviceId);
        return true;
    }

    /**
     * Before registering a new device with {@code installKey}: retire the account's devices with the same key
     * (this phone's previous installs). Returns the removed device ids.
     */
    public List<Integer> retireSameInstall(String username, String installKey) {
        if (installKey == null) return List.of();
        List<Integer> removed = new ArrayList<>();
        for (Device d : devices.findByUsernameOrderByDeviceIdAsc(username)) {
            if (installKey.equals(d.getInstallKey()) && retire(username, d.getDeviceId())) removed.add(d.getDeviceId());
        }
        if (!removed.isEmpty()) log.info("Device re-registration for {} replaced devices {}", username, removed);
        return removed;
    }

    /**
     * An already-registered device reports its install key (once, from an app build that knows the key):
     * store it, then retire this phone's other installs — keyed ones with the same key, and keyless
     * predecessors (see class comment). Returns the removed device ids; null if the device isn't the caller's.
     */
    public List<Integer> claim(String username, int deviceId, String installKey) {
        String key = SignalKeyService.validInstallKey(Objects.requireNonNull(installKey, "installKey is required"));
        Device self = devices.findByUsernameAndDeviceId(username, deviceId).orElse(null);
        if (self == null) return null;
        if (!key.equals(self.getInstallKey())) {
            self.setInstallKey(key);
            devices.save(self);
        }
        List<Integer> removed = new ArrayList<>();
        for (Device d : devices.findByUsernameOrderByDeviceIdAsc(username)) {
            if (d.getDeviceId() == deviceId) continue;
            if (key.equals(d.getInstallKey()) || isKeylessPredecessor(self, d)) {
                if (retire(username, d.getDeviceId())) removed.add(d.getDeviceId());
            }
        }
        if (!removed.isEmpty()) log.info("Device {} of {} claimed its install key; retired devices {}", deviceId, username, removed);
        return removed;
    }

    /**
     * A keyless Android-app device registered before {@code self}, with the same model label, and silent since
     * {@code self} was created: the uninstalled copy of the app on this phone.
     */
    static boolean isKeylessPredecessor(Device self, Device other) {
        return other.getInstallKey() == null
            && self.getLabel() != null
            && self.getLabel().endsWith(ANDROID_LABEL_SUFFIX)
            && self.getLabel().equals(other.getLabel())
            && other.getDeviceId() < self.getDeviceId()
            && other.getLastSeen().isBefore(self.getCreatedAt());
    }

    /** Every 6 hours: retire devices idle for longer than the stale period, keeping each account's freshest. */
    @Scheduled(initialDelayString = "PT10M", fixedDelayString = "PT6H")
    public void pruneInactive() {
        try {
            int n = pruneInactive(clock.instant());
            if (n > 0) log.info("Pruned {} inactive device(s)", n);
        } catch (RuntimeException e) {
            log.warn("Inactive-device prune failed: {}", e.toString());
        }
    }

    int pruneInactive(Instant now) {
        Instant cutoff = now.minus(staleAfter);
        Map<String, List<Device>> staleByUser = devices.findByLastSeenBefore(cutoff).stream()
            .collect(Collectors.groupingBy(Device::getUsername));
        int removed = 0;
        for (Map.Entry<String, List<Device>> e : staleByUser.entrySet()) {
            String username = e.getKey();
            // The account's freshest device (stale or not) always stays.
            Device freshest = devices.findByUsernameOrderByDeviceIdAsc(username).stream()
                .max(Comparator.comparing(Device::getLastSeen).thenComparingInt(Device::getDeviceId))
                .orElse(null);
            for (Device d : e.getValue()) {
                if (freshest != null && d.getDeviceId() == freshest.getDeviceId()) continue;
                if (retire(username, d.getDeviceId())) {
                    removed++;
                    log.info("Pruned device {} of {} (last seen {})", d.getDeviceId(), username, d.getLastSeen());
                }
            }
        }
        return removed;
    }
}

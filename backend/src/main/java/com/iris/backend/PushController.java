package com.iris.backend;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/push")
public class PushController {

    private final PushSubscriptionRepository subscriptions;
    private final FcmTokenRepository fcmTokens;
    private final DeviceRepository devices;

    @Value("${vapid.public-key}")
    private String vapidPublicKey;

    public PushController(PushSubscriptionRepository subscriptions, FcmTokenRepository fcmTokens, DeviceRepository devices) {
        this.subscriptions = subscriptions;
        this.fcmTokens = fcmTokens;
        this.devices = devices;
    }

    /**
     * `app` is optional: absent = a client from before the field existed (legacy notification behaviour).
     * `deviceId` is optional: the caller's own Signal device id, sent only by mobile builds that decrypt
     * data-only message pushes themselves. Absent = keep sending the generic visible notification.
     */
    public record FcmTokenRequest(String token, String app, Integer deviceId) {}

    /**
     * Android app registers its FCM token. Idempotent; if the device was last
     * used by another account, the token moves to the caller so alerts for the
     * previous user stop reaching this phone.
     */
    @PostMapping("/fcm-token")
    public ResponseEntity<Void> registerFcmToken(@RequestBody FcmTokenRequest req, Authentication auth) {
        if (req.token() == null || req.token().isBlank() || req.token().length() > 4096) {
            return ResponseEntity.badRequest().build();
        }
        String username = auth.getName();
        FcmToken row = fcmTokens.findByToken(req.token())
                .orElseGet(() -> new FcmToken(username, req.token()));
        row.setUsername(username);
        row.setApp(sanitizeApp(req.app()));
        // Only a device of the caller's own account: a token must never pull someone else's envelopes.
        Integer deviceId = req.deviceId();
        row.setDeviceId(deviceId != null && devices.existsByUsernameAndDeviceId(username, deviceId) ? deviceId : null);
        fcmTokens.save(row);
        return ResponseEntity.ok().build();
    }

    /** Keep only a plausible application id; anything else is treated as "unknown / legacy". */
    static String sanitizeApp(String app) {
        if (app == null) return null;
        String a = app.trim();
        return a.matches("[A-Za-z0-9._-]{1,128}") ? a : null;
    }

    /** Called on logout. Only the token's owner may remove it. */
    @DeleteMapping("/fcm-token")
    public ResponseEntity<Void> unregisterFcmToken(@RequestBody FcmTokenRequest req, Authentication auth) {
        if (req.token() == null) return ResponseEntity.badRequest().build();
        fcmTokens.findByToken(req.token())
                .filter(t -> t.getUsername().equals(auth.getName()))
                .ifPresent(fcmTokens::delete);
        return ResponseEntity.noContent().build();
    }

    /** Frontend calls this to learn which key to subscribe with. */
    @GetMapping("/vapid-public-key")
    public String getVapidPublicKey() {
        return vapidPublicKey;
    }

    /** Body matches the shape of the browser's PushSubscription.toJSON(). */
    public record SubscribeRequest(String endpoint, Keys keys) {
        public record Keys(String p256dh, String auth) {}
    }

    @PostMapping("/subscribe")
    public void subscribe(@RequestBody SubscribeRequest req, Authentication auth) {
        String username = auth.getName();
        // Idempotent: if endpoint already exists, skip insert.
        subscriptions.findByEndpoint(req.endpoint()).ifPresentOrElse(
            existing -> { /* already stored — nothing to do */ },
            () -> subscriptions.save(new PushSubscription(
                username,
                req.endpoint(),
                req.keys().p256dh(),
                req.keys().auth()
            ))
        );
    }
}

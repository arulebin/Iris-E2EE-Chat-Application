package com.iris.backend;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/push")
public class PushController {

    private final PushSubscriptionRepository subscriptions;

    @Value("${vapid.public-key}")
    private String vapidPublicKey;

    public PushController(PushSubscriptionRepository subscriptions) {
        this.subscriptions = subscriptions;
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

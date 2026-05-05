package com.iris.backend;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.Subscription;
import tools.jackson.databind.ObjectMapper;

import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.security.Security;
import java.util.List;
import java.util.Map;

@Service
public class PushNotificationService {

    private static final Logger log = LoggerFactory.getLogger(PushNotificationService.class);

    private final PushSubscriptionRepository subscriptions;
    private final ObjectMapper objectMapper;
    private final nl.martijndwars.webpush.PushService webPushService;

    public PushNotificationService(
            PushSubscriptionRepository subscriptions,
            ObjectMapper objectMapper,
            @Value("${vapid.public-key}")  String publicKey,
            @Value("${vapid.private-key}") String privateKey,
            @Value("${vapid.subject}")      String subject
    ) throws Exception {
        this.subscriptions = subscriptions;
        this.objectMapper  = objectMapper;
        Security.addProvider(new BouncyCastleProvider());   // web-push needs BC for ECC
        this.webPushService = new nl.martijndwars.webpush.PushService(publicKey, privateKey, subject);
    }

    /** Send a notification to *all* of this user's subscriptions. */
    public void sendToUser(String username, String title, String body) {
        List<PushSubscription> subs = subscriptions.findByUsername(username);
        for (PushSubscription sub : subs) {
            try {
                String payload = objectMapper.writeValueAsString(Map.of(
                        "title", title,
                        "body",  body
                ));
                Subscription nlSub = new Subscription(
                        sub.getEndpoint(),
                        new Subscription.Keys(sub.getP256dh(), sub.getAuth())
                );
                var notification = new Notification(nlSub, payload);
                var response = webPushService.send(notification);
                int status = response.getStatusLine().getStatusCode();

                // 404 = endpoint unknown; 410 = subscription gone — remove it.
                if (status == 404 || status == 410) {
                    log.info("Removing dead subscription for {} (HTTP {})", username, status);
                    subscriptions.delete(sub);
                }
            } catch (Exception e) {
                log.error("Push to {} failed", sub.getEndpoint(), e);
            }
        }
    }
}

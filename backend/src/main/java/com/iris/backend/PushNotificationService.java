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
    private final FcmSender fcmSender;

    public PushNotificationService(
            PushSubscriptionRepository subscriptions,
            ObjectMapper objectMapper,
            FcmSender fcmSender,
            @Value("${vapid.public-key}")  String publicKey,
            @Value("${vapid.private-key}") String privateKey,
            @Value("${vapid.subject}")      String subject
    ) throws Exception {
        this.subscriptions = subscriptions;
        this.objectMapper  = objectMapper;
        this.fcmSender     = fcmSender;
        Security.addProvider(new BouncyCastleProvider());   // web-push needs BC for ECC
        this.webPushService = new nl.martijndwars.webpush.PushService(publicKey, privateKey, subject);
    }

    /** Send a notification to *all* of this user's subscriptions. */
    public void sendToUser(String username, String title, String body) {
        sendToUser(username, title, body, false);
    }

    /**
     * Incoming call. Web push and legacy FCM tokens get the generic visible notification; tokens of the
     * mobile app get a data-only message (see FcmSender.planIncomingCall).
     */
    public void sendIncomingCall(String username, String callId, String mode) {
        fcmSender.sendIncomingCall(username, callId, mode);
        sendWebPush(username, "Iris", "Incoming call");
    }

    /** The ringing call is over and the callee has no live socket: stop the mobile app's native ringing. */
    public void sendCallCancelled(String username, String callId) {
        fcmSender.sendCallCancelled(username, callId);
    }

    /**
     * New chat message for an inactive user. The mobile app gets a data-only push with its own device's
     * ciphertext (see FcmSender.planMessage); legacy FCM tokens and browsers get the generic notification.
     * `envelopes` are this user's copies of the message, null for a legacy v1 message.
     */
    public void sendNewMessage(String username, long messageId, List<MessageEnvelope> envelopes) {
        fcmSender.sendNewMessage(username, messageId, envelopes);
        sendWebPush(username, "Iris", "New message");
    }

    /** Connection request received / accepted: data-only wake for the mobile app, generic text elsewhere. */
    public void sendSocial(String username, FcmSender.SocialEvent event) {
        String body = event == FcmSender.SocialEvent.REQUEST ? "New connection request" : "Connection request accepted";
        fcmSender.sendSocial(username, event, body);
        sendWebPush(username, "Iris", body);
    }

    /**
     * Fan out to both browser (Web Push) subscriptions and Android (FCM) devices.
     * `urgent` marks call alerts: high priority + the "calls" channel on Android.
     */
    public void sendToUser(String username, String title, String body, boolean urgent) {
        fcmSender.sendToUser(username, title, body, urgent);
        sendWebPush(username, title, body);
    }

    private void sendWebPush(String username, String title, String body) {
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

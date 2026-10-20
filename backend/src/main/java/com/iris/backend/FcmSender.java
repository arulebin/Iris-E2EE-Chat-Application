package com.iris.backend;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.AndroidNotification;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.FileInputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

/**
 * Sends Android push via Firebase Cloud Messaging. Disabled (a no-op) unless
 * FIREBASE_CREDENTIALS_FILE points at a service-account JSON, so the backend
 * still runs for web-only deployments.
 */
@Service
public class FcmSender {

    private static final Logger log = LoggerFactory.getLogger(FcmSender.class);

    private final FcmTokenRepository tokens;

    @Value("${firebase.credentials-file:}")
    private String credentialsFile;

    private FirebaseMessaging messaging;

    public FcmSender(FcmTokenRepository tokens) {
        this.tokens = tokens;
    }

    @PostConstruct
    void init() {
        if (credentialsFile == null || credentialsFile.isBlank()) {
            log.info("FCM disabled: firebase.credentials-file not set (Android push off)");
            return;
        }
        try (InputStream in = new FileInputStream(credentialsFile)) {
            FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(in))
                    .build();
            FirebaseApp app = FirebaseApp.getApps().isEmpty()
                    ? FirebaseApp.initializeApp(options)
                    : FirebaseApp.getInstance();
            this.messaging = FirebaseMessaging.getInstance(app);
            log.info("FCM enabled");
        } catch (Exception e) {
            log.error("FCM disabled: could not load credentials from {}", credentialsFile, e);
        }
    }

    /** Application id of the React Native app; it handles data-only call pushes natively. */
    public static final String MOBILE_APP_ID = "com.iris.chat.mobile";

    /** What one FCM token receives for a call event. Pure data so the routing rule is testable. */
    record CallPushPlan(boolean dataOnly, Map<String, String> data) { }

    /**
     * Incoming call: the mobile app gets a DATA-ONLY high-priority message (its own FirebaseMessagingService
     * rings the call UI; the payload carries no names). Everything else (legacy Capacitor app, tokens without an
     * app id) needs a visible notification, so it keeps the generic one.
     */
    static CallPushPlan planIncomingCall(String app, String callId, String mode) {
        if (MOBILE_APP_ID.equals(app)) {
            return new CallPushPlan(true, Map.of("type", "incoming-call", "callId", callId == null ? "" : callId,
                    "mode", "audio".equals(mode) ? "audio" : "video"));
        }
        return new CallPushPlan(false, Map.of());
    }

    /** The caller hung up / call handled while the callee had no live socket. Only the mobile app can act on it. */
    static CallPushPlan planCallCancelled(String app, String callId) {
        if (MOBILE_APP_ID.equals(app) && callId != null && !callId.isBlank()) {
            return new CallPushPlan(true, Map.of("type", "call-cancelled", "callId", callId));
        }
        return new CallPushPlan(false, Map.of());
    }

    // ── messages ──────────────────────────────────────────────────────

    /** FCM refuses data payloads over 4 KB (keys + values); stay well below it. */
    static final int MAX_DATA_BYTES = 3_500;
    static final long MESSAGE_TTL_MS = 24L * 60 * 60 * 1000;

    /**
     * What one token receives for a new message. `dataOnly` = high-priority data message the mobile app
     * decrypts itself; otherwise the generic visible "Iris / New message" notification. `collapseKey` is set
     * only for wake-ups (they all mean the same thing: "fetch what is pending").
     */
    record MessagePushPlan(boolean dataOnly, Map<String, String> data, String collapseKey) { }

    private static final MessagePushPlan VISIBLE = new MessagePushPlan(false, Map.of(), null);
    private static final MessagePushPlan WAKE = new MessagePushPlan(true, Map.of("type", "msg-wake"), "msg-wake");

    /**
     * A v2 message for one token. Only the mobile app with a known Signal device gets a data push, and it
     * carries nothing but that device's ciphertext and opaque ids: no sender, no group, no text. The app looks
     * up the (sender, group) metadata over its authenticated API after waking. Legacy apps and tokens without a
     * device id keep the visible generic notification (they cannot handle data messages).
     *
     * @param envelopes this user's envelopes of the message (one per device); null for a legacy v1 message
     */
    static MessagePushPlan planMessage(String app, Integer tokenDeviceId, long messageId, List<MessageEnvelope> envelopes) {
        if (!MOBILE_APP_ID.equals(app) || tokenDeviceId == null || envelopes == null) return VISIBLE;
        MessageEnvelope mine = envelopes.stream()
                .filter(e -> e.getTargetDeviceId() == tokenDeviceId && e.getId() != null)
                .findFirst().orElse(null);
        // No copy for this device (removed / re-registered): let it sync whatever is pending.
        if (mine == null) return WAKE;
        Map<String, String> data = Map.of(
                "type", "msg",
                "mid", Long.toString(messageId),
                "eid", Long.toString(mine.getId()),
                "et", Integer.toString(mine.getType()),
                "env", mine.getBody());
        return dataBytes(data) > MAX_DATA_BYTES ? WAKE : new MessagePushPlan(true, data, null);
    }

    static int dataBytes(Map<String, String> data) {
        int n = 0;
        for (Map.Entry<String, String> e : data.entrySet()) {
            n += e.getKey().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            n += e.getValue().getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        }
        return n;
    }

    /** A new v1/v2 message for `username`; `envelopes` = that user's copies (null for v1). */
    public void sendNewMessage(String username, long messageId, List<MessageEnvelope> envelopes) {
        if (messaging == null) return;
        for (FcmToken t : tokens.findByUsername(username)) {
            MessagePushPlan plan = planMessage(t.getApp(), t.getDeviceId(), messageId, envelopes);
            deliver(username, t, plan.dataOnly()
                    ? dataMessage(t, plan.data(), plan.collapseKey(), MESSAGE_TTL_MS)
                    : visibleMessage(t, "Iris", "New message", false));
        }
    }

    /** Friend-request events. The app resolves the name itself after waking; nothing but the kind leaves. */
    enum SocialEvent { REQUEST, ACCEPTED }

    static MessagePushPlan planSocial(String app, Integer tokenDeviceId, SocialEvent event) {
        if (!MOBILE_APP_ID.equals(app) || tokenDeviceId == null) return VISIBLE;
        String type = event == SocialEvent.REQUEST ? "friend-request" : "friend-accepted";
        return new MessagePushPlan(true, Map.of("type", type), type);
    }

    public void sendSocial(String username, SocialEvent event, String legacyBody) {
        if (messaging == null) return;
        for (FcmToken t : tokens.findByUsername(username)) {
            MessagePushPlan plan = planSocial(t.getApp(), t.getDeviceId(), event);
            deliver(username, t, plan.dataOnly()
                    ? dataMessage(t, plan.data(), plan.collapseKey(), MESSAGE_TTL_MS)
                    : visibleMessage(t, "Iris", legacyBody, false));
        }
    }

    private static Message dataMessage(FcmToken t, Map<String, String> data, String collapseKey, long ttlMs) {
        AndroidConfig.Builder android = AndroidConfig.builder()
                .setPriority(AndroidConfig.Priority.HIGH)   // only high priority may start the app's work when killed
                .setTtl(ttlMs);
        if (collapseKey != null) android.setCollapseKey(collapseKey);
        return Message.builder().setToken(t.getToken()).putAllData(data).setAndroidConfig(android.build()).build();
    }

    private static Message visibleMessage(FcmToken t, String title, String body, boolean urgent) {
        return Message.builder()
                .setToken(t.getToken())
                .setAndroidConfig(AndroidConfig.builder()
                        .setPriority(urgent ? AndroidConfig.Priority.HIGH : AndroidConfig.Priority.NORMAL)
                        .setTtl(urgent ? 30_000L : MESSAGE_TTL_MS)
                        .setNotification(AndroidNotification.builder()
                                .setTitle(title)
                                .setBody(body)
                                .setChannelId(urgent ? "calls" : "messages")
                                .setVisibility(AndroidNotification.Visibility.PRIVATE)
                                .build())
                        .build())
                .build();
    }

    /** True when the user has at least one token that needs the generic (visible) call notification. */
    public void sendIncomingCall(String username, String callId, String mode) {
        if (messaging == null) return;
        for (FcmToken t : tokens.findByUsername(username)) {
            CallPushPlan plan = planIncomingCall(t.getApp(), callId, mode);
            Message.Builder b = Message.builder().setToken(t.getToken());
            if (plan.dataOnly()) {
                b.putAllData(plan.data()).setAndroidConfig(AndroidConfig.builder()
                        .setPriority(AndroidConfig.Priority.HIGH)
                        .setTtl(45_000L)
                        .build());
            } else {
                b.setAndroidConfig(AndroidConfig.builder()
                        .setPriority(AndroidConfig.Priority.HIGH)
                        .setTtl(30_000L)
                        .setNotification(AndroidNotification.builder()
                                .setTitle("Iris").setBody("Incoming call").setChannelId("calls")
                                .setVisibility(AndroidNotification.Visibility.PRIVATE)
                                .build())
                        .build());
            }
            deliver(username, t, b.build());
        }
    }

    public void sendCallCancelled(String username, String callId) {
        if (messaging == null) return;
        for (FcmToken t : tokens.findByUsername(username)) {
            CallPushPlan plan = planCallCancelled(t.getApp(), callId);
            if (!plan.dataOnly()) continue;
            deliver(username, t, Message.builder().setToken(t.getToken()).putAllData(plan.data())
                    .setAndroidConfig(AndroidConfig.builder()
                            .setPriority(AndroidConfig.Priority.HIGH)
                            .setTtl(10_000L)
                            .build())
                    .build());
        }
    }

    private void deliver(String username, FcmToken t, Message msg) {
        try {
            messaging.send(msg);
        } catch (FirebaseMessagingException e) {
            MessagingErrorCode code = e.getMessagingErrorCode();
            if (code == MessagingErrorCode.UNREGISTERED || code == MessagingErrorCode.SENDER_ID_MISMATCH) {
                log.info("Removing dead FCM token for {} ({})", username, code);
                tokens.delete(t);
            } else {
                log.error("FCM push to {} failed ({})", username, code, e);
            }
        } catch (Exception e) {
            log.error("FCM push to {} failed", username, e);
        }
    }

    /**
     * Notify every Android device of this user. Only generic text is sent —
     * no sender, no content — because the payload passes through Google.
     * Calls go out high-priority on the "calls" channel so they ring in Doze.
     */
    public void sendToUser(String username, String title, String body, boolean urgent) {
        if (messaging == null) return;
        for (FcmToken t : tokens.findByUsername(username)) {
            deliver(username, t, visibleMessage(t, title, body, urgent));
        }
    }
}

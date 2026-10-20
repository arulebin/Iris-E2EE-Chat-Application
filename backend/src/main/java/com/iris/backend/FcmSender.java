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

    /**
     * Notify every Android device of this user. Only generic text is sent —
     * no sender, no content — because the payload passes through Google.
     * Calls go out high-priority on the "calls" channel so they ring in Doze.
     */
    public void sendToUser(String username, String title, String body, boolean urgent) {
        if (messaging == null) return;
        List<FcmToken> userTokens = tokens.findByUsername(username);
        for (FcmToken t : userTokens) {
            Message msg = Message.builder()
                    .setToken(t.getToken())
                    .setAndroidConfig(AndroidConfig.builder()
                            .setPriority(urgent ? AndroidConfig.Priority.HIGH : AndroidConfig.Priority.NORMAL)
                            .setTtl(urgent ? 30_000L : 24L * 60 * 60 * 1000)
                            .setNotification(AndroidNotification.builder()
                                    .setTitle(title)
                                    .setBody(body)
                                    .setChannelId(urgent ? "calls" : "messages")
                                    .setVisibility(AndroidNotification.Visibility.PRIVATE)
                                    .build())
                            .build())
                    .build();
            try {
                messaging.send(msg);
            } catch (FirebaseMessagingException e) {
                MessagingErrorCode code = e.getMessagingErrorCode();
                // Only prune on errors that mean "this token is dead". INVALID_ARGUMENT
                // can also mean a malformed message, so it must not wipe tokens.
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
    }
}

package com.iris.backend;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final MessageRepository messageRepository;
    private final ObjectMapper objectMapper;

    // username → that user's open sessions (could be multiple tabs)
    private final Map<String, Set<WebSocketSession>> sessionsByUser = new ConcurrentHashMap<>();

    private final PushNotificationService pushNotificationService;

    public ChatWebSocketHandler(
            MessageRepository messageRepository,
            ObjectMapper objectMapper,
            PushNotificationService pushNotificationService
    ) {
        this.messageRepository = messageRepository;
        this.objectMapper = objectMapper;
        this.pushNotificationService = pushNotificationService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String username = (String) session.getAttributes().get("username");
        session.getAttributes().put("visible", Boolean.TRUE);  // assume visible until told otherwise
        sessionsByUser
            .computeIfAbsent(username, k -> new CopyOnWriteArraySet<>())
            .add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String username = (String) session.getAttributes().get("username");
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions != null) {
            userSessions.remove(session);
            if (userSessions.isEmpty()) {
                sessionsByUser.remove(username);
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage textMessage) throws Exception {
        String sender = (String) session.getAttributes().get("username");

        // Inspect type without fully deserializing
        JsonNode root = objectMapper.readTree(textMessage.getPayload());
        String type = root.has("type") ? root.get("type").asText() : "chat";

        if ("visibility".equals(type)) {
            // Tab signaled foreground/background — used to decide whether to push
            boolean visible = root.has("state") && "visible".equals(root.get("state").asText());
            session.getAttributes().put("visible", visible);
            return;
        }

        if (type.startsWith("call-")) {
            // Signaling — forward as-is to recipient with `from` added
            if (!root.has("to")) return;
            String to = root.get("to").asText();
            ObjectNode forwarded =
                    ((ObjectNode) root).put("from", sender);
            // call-offer rings only ONE session (the most recently connected),
            // so a user with several open tabs doesn't get every tab ringing —
            // and a stale tab can't race-answer a fresh tab. All other call-*
            // messages broadcast normally; the receiving sessions decide what to do.
            if ("call-offer".equals(type)) {
                sendToOneSession(to, forwarded.toString());
            } else {
                sendToUser(to, forwarded.toString());
            }
            return;
        }

        // ── existing chat logic (encrypt, persist, route) ──
        IncomingMessage incoming = objectMapper.treeToValue(root, IncomingMessage.class);

        if (incoming.to() == null || incoming.to().isBlank()
            || incoming.content() == null || incoming.content().isBlank()) {
            return;
        }

        Message saved = messageRepository.save(new Message(
            sender, incoming.to(), incoming.content(),
            incoming.encryptedKeyForSender(), incoming.encryptedKeyForRecipient()
        ));

        OutgoingMessage out = new OutgoingMessage(
            saved.getSender(), saved.getRecipient(), saved.getContent(),
            saved.getEncryptedKeyForSender(), saved.getEncryptedKeyForRecipient(),
            saved.getSentAt()
        );
        String payload = objectMapper.writeValueAsString(out);

        java.util.Set<String> targets = new java.util.HashSet<>();
        targets.add(incoming.to());
        targets.add(sender);
        for (String username : targets) sendToUser(username, payload);

        // "Active" = at least one session is open AND its tab is visible.
        // Backgrounded tabs no longer count as online — push fires for them so the user actually sees the notification.
        Set<WebSocketSession> recipientSessions = sessionsByUser.getOrDefault(incoming.to(), Set.of());
        boolean recipientActive = recipientSessions.stream()
            .anyMatch(s -> s.isOpen()
                && Boolean.TRUE.equals(s.getAttributes().getOrDefault("visible", Boolean.TRUE)));
        if (!recipientActive) {
            pushNotificationService.sendToUser(incoming.to(), "Iris", "New message from " + sender);
        }
    }


    private void sendToUser(String username, String payload) throws IOException {
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions == null) return;
        for (WebSocketSession s : userSessions) {
            if (s.isOpen()) {
                s.sendMessage(new TextMessage(payload));
            }
        }
    }

    /**
     * Send to exactly one session — the most recently added open session for the user.
     * CopyOnWriteArraySet iterates in insertion order, so the last open session in
     * iteration is the one most recently connected.
     */
    private void sendToOneSession(String username, String payload) throws IOException {
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions == null) return;
        WebSocketSession latest = null;
        for (WebSocketSession s : userSessions) {
            if (s.isOpen()) latest = s;
        }
        if (latest != null) {
            latest.sendMessage(new TextMessage(payload));
        }
    }
}

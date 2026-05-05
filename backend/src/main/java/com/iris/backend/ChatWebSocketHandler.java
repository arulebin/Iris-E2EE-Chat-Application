package com.iris.backend;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.ObjectMapper;

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

    public ChatWebSocketHandler(MessageRepository messageRepository, ObjectMapper objectMapper) {
        this.messageRepository = messageRepository;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String username = (String) session.getAttributes().get("username");
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

        IncomingMessage incoming;
        try {
            incoming = objectMapper.readValue(textMessage.getPayload(), IncomingMessage.class);
        } catch (Exception e) {
            return;   // ignore malformed JSON
        }

        if (incoming.to() == null || incoming.to().isBlank()
            || incoming.content() == null || incoming.content().isBlank()) {
            return;   // missing fields
        }

        // persist
        Message saved = messageRepository.save(new Message(sender, incoming.to(), incoming.content(), incoming.encryptedKeyForSender(), incoming.encryptedKeyForRecipient()));

        // build outgoing payload
        OutgoingMessage out = new OutgoingMessage(
            saved.getSender(),
            saved.getRecipient(),
            saved.getContent(),
            saved.getEncryptedKeyForSender(),
            saved.getEncryptedKeyForRecipient(),
            saved.getSentAt()
        );
        String payload = objectMapper.writeValueAsString(out);

        // deliver to recipient AND echo to sender (so their UI can display)
        Set<String> targets = new HashSet<>();
        targets.add(incoming.to());
        targets.add(sender);

        for (String username : targets) {
            sendToUser(username, payload);
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
}

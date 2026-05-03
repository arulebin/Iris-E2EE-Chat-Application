package com.iris.backend;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    // a thread-safe set of all open client connections
    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        // TODO 1: a new client just connected — remember its session
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        // TODO 2: the client disconnected — forget its session
        sessions.remove(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // TODO 3: a client sent a message. Broadcast it to every other open session.
        //         (For now, the sender will also receive their own message back — fine for testing.)
        sessions.forEach(s -> {
            if (s.isOpen()) {
                try {
                    s.sendMessage(new TextMessage(message.getPayload()));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        });    
    }
}

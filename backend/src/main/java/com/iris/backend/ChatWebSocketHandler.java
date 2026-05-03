package com.iris.backend;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.List;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
    private final MessageRepository messageRepository;

    public ChatWebSocketHandler(MessageRepository messageRepository){
        this.messageRepository=messageRepository;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception{
        sessions.add(session);
        List<Message> recentMessages = messageRepository.findTop50ByOrderBySentAtDesc();
        java.util.Collections.reverse(recentMessages);
        for (Message msg:recentMessages){
            session.sendMessage(new TextMessage(msg.getSender() + ": " + msg.getContent()));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String username = (String) session.getAttributes().get("username");
        String formatted = username + ": " + message.getPayload();
        messageRepository.save(new Message(username, message.getPayload()));

        for (WebSocketSession s : sessions) {
            if (s.isOpen()) {
                s.sendMessage(new TextMessage(formatted));
            }
        }  
        }
}

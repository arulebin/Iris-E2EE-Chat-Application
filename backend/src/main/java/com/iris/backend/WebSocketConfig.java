package com.iris.backend;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler chatHandler;
    private final JwtHandshakeInterceptor jwtInterceptor;        // ← new

    public WebSocketConfig(ChatWebSocketHandler chatHandler,
                           JwtHandshakeInterceptor jwtInterceptor) {  // ← new
        this.chatHandler = chatHandler;
        this.jwtInterceptor = jwtInterceptor;
    }

    // A Signal send carries one ciphertext per target device, so a long message to
    // someone with several devices easily passes Tomcat's 8 KB default — and an
    // oversized frame closes the socket (1009), losing the message. The client caps
    // text well below this (see frontend lib/limits.ts).
    static final int MAX_MESSAGE_BYTES = 1024 * 1024;
    // Safety net for half-open sockets from clients that don't heartbeat.
    static final long MAX_IDLE_MS = 5 * 60_000L;

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(MAX_MESSAGE_BYTES);
        container.setMaxBinaryMessageBufferSize(MAX_MESSAGE_BYTES);
        container.setMaxSessionIdleTimeout(MAX_IDLE_MS);
        return container;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatHandler, "/ws/chat")
                .addInterceptors(jwtInterceptor)                  // ← new
                .setAllowedOrigins("*");
    }
}

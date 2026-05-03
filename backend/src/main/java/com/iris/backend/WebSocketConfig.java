package com.iris.backend;

import org.springframework.context.annotation.Configuration;
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

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatHandler, "/ws/chat")
                .addInterceptors(jwtInterceptor)                  // ← new
                .setAllowedOrigins("*");
    }
}

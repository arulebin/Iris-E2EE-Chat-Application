package com.iris.backend;

import org.junit.jupiter.api.Test;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import static org.junit.jupiter.api.Assertions.*;

class TransportLimitsTest {

    @Test
    void webSocketAcceptsMultiDeviceFanoutFrames() {
        WebSocketConfig config = new WebSocketConfig(null, null);
        ServletServerContainerFactoryBean container = config.createWebSocketContainer();
        // Tomcat's 8 KB default closed the socket on long multi-device sends.
        assertTrue(container.getMaxTextMessageBufferSize() >= 512 * 1024);
        assertEquals(WebSocketConfig.MAX_MESSAGE_BYTES, container.getMaxTextMessageBufferSize());
        assertNotNull(container.getMaxSessionIdleTimeout());
        assertTrue(container.getMaxSessionIdleTimeout() > ChatWebSocketHandler.HEARTBEAT_TIMEOUT_MS);
    }

    @Test
    void cappedCopyStopsAtLimit() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertEquals(10, BackupController.copyCapped(new ByteArrayInputStream(new byte[10]), out, 10));
        assertEquals(-1, BackupController.copyCapped(new ByteArrayInputStream(new byte[11]), new ByteArrayOutputStream(), 10));
        assertEquals(0, BackupController.copyCapped(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), 10));
    }

    @Test
    void usernameRule() {
        for (String ok : new String[] {"bob", "Ebin_A", "user_123", "a".repeat(32)})
            assertTrue(UserService.USERNAME.matcher(ok).matches(), ok);
        for (String bad : new String[] {"ab", "john.doe", "bob:x", "a b", "a/b", "ünï", "a".repeat(33), ""})
            assertFalse(UserService.USERNAME.matcher(bad).matches(), bad);
    }
}

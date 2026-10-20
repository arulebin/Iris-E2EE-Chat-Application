package com.iris.backend;

import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.URI;
import java.util.Map;

@Component
public class JwtHandshakeInterceptor implements HandshakeInterceptor {

    private final JwtService jwtService;
    private final DeviceRepository deviceRepository;

    public JwtHandshakeInterceptor(JwtService jwtService, DeviceRepository deviceRepository) {
        this.jwtService = jwtService;
        this.deviceRepository = deviceRepository;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request,
                                   ServerHttpResponse response,
                                   WebSocketHandler wsHandler,
                                   Map<String, Object> attributes) {

        String token = queryParam(request.getURI(), "token");
        if (token == null) return false;        // no token → reject

        String username;
        try {
            username = jwtService.extractUsername(token);  // throws if invalid
        } catch (Exception e) {
            return false;                                  // bad/expired token → reject
        }
        attributes.put("username", username);              // remember on the session

        // Optional Signal-protocol device id. A device that was removed still gets
        // its socket (so it can be told), but is flagged and receives no envelopes.
        String device = queryParam(request.getURI(), "device");
        if (device != null) {
            try {
                int deviceId = Integer.parseInt(device);
                if (deviceRepository.existsByUsernameAndDeviceId(username, deviceId)) {
                    attributes.put("deviceId", deviceId);
                } else {
                    attributes.put("deviceRevoked", Boolean.TRUE);
                }
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return true;                                       // accept handshake
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // nothing to do
    }

    private String queryParam(URI uri, String name) {
        String query = uri.getQuery();
        if (query == null) return null;
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length == 2 && name.equals(kv[0])) {
                return kv[1];
            }
        }
        return null;
    }
}

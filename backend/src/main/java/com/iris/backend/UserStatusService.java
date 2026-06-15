package com.iris.backend;

import org.springframework.stereotype.Component;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class UserStatusService {

    private final Set<String> online = ConcurrentHashMap.newKeySet();
    private final Map<String, Instant> lastSeen = new ConcurrentHashMap<>();

    public void markOnline(String username) {
        online.add(username);
    }

    public void markOffline(String username) {
        online.remove(username);
        lastSeen.put(username, Instant.now());
    }

    public boolean isOnline(String username) {
        return online.contains(username);
    }

    public Instant getLastSeen(String username) {
        return lastSeen.get(username);
    }
}

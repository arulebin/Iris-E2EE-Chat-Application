package com.iris.backend;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Sliding-window limit on invite-code lookups, per account and per client IP, so
 * nobody can walk the code space. In-memory: fine for the single backend we run,
 * but with several instances each would keep its own counts (move to Redis then).
 */
@Component
public class InviteRateLimiter {

    static final long WINDOW_MS = 10 * 60 * 1000;
    static final int PER_USER = 20;
    static final int PER_IP = 60;

    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    /** Records one attempt; false if either the user or the IP is over its limit. */
    public boolean tryAcquire(String username, HttpServletRequest request) {
        long now = System.currentTimeMillis();
        boolean userOk = record("u:" + username, PER_USER, now);
        boolean ipOk = record("ip:" + clientIp(request), PER_IP, now);
        if (hits.size() > 10_000) prune(now);
        return userOk && ipOk;
    }

    private boolean record(String key, int limit, long now) {
        Deque<Long> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && now - q.peekFirst() > WINDOW_MS) q.pollFirst();
            if (q.size() >= limit) return false;
            q.addLast(now);
            return true;
        }
    }

    private void prune(long now) {
        hits.entrySet().removeIf(e -> {
            synchronized (e.getValue()) {
                Long last = e.getValue().peekLast();
                return last == null || now - last > WINDOW_MS;
            }
        });
    }

    // Behind Caddy the socket peer is the proxy, so take the first X-Forwarded-For
    // hop — but only when the peer is a private/loopback address (i.e. our proxy),
    // otherwise any client could spoof the header to dodge the limit.
    static String clientIp(HttpServletRequest request) {
        String peer = request.getRemoteAddr();
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank() && isPrivate(peer)) {
            return xff.split(",")[0].trim();
        }
        return peer;
    }

    private static boolean isPrivate(String ip) {
        if (ip == null) return false;
        return ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.")
                || ip.equals("::1") || ip.equals("0:0:0:0:0:0:0:1")
                || ip.matches("^172\\.(1[6-9]|2\\d|3[01])\\..*");
    }
}

package com.iris.backend;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Relays WebRTC call signalling (call-*) between users.
 *
 * A call rings every device of the callee. When one device answers, the call is
 * "pinned" to that device and to the caller's device, the callee's other devices
 * get a call-end (reason answered-elsewhere), and all further signals go only to
 * the two pinned devices. A user already pinned into a call is busy.
 *
 * The latest offer for an offline callee is held briefly so a device woken by
 * the "Incoming call" push can still pick it up when its socket connects.
 *
 * A dropped socket does NOT end the call — WebRTC media flows peer to peer and
 * survives signalling outages. The client re-pins with call-resume when it
 * reconnects; if the device is really gone, the peer's ICE failure ends it.
 */
class CallRelay {

    static final Duration RING_WINDOW = Duration.ofSeconds(45);

    private record Pin(String peer, String callId) { }
    private record PendingOffer(String from, String callId, String frame, Instant at) { }

    private final ObjectMapper objectMapper;
    private final Function<String, Set<WebSocketSession>> sessionsOf;
    private final Predicate<String> isActive;
    private final PushNotificationService push;

    private final Map<WebSocketSession, Pin> pins = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> pinnedSessionOf = new ConcurrentHashMap<>();
    private final Map<String, PendingOffer> pendingOffers = new ConcurrentHashMap<>();

    CallRelay(ObjectMapper objectMapper,
              Function<String, Set<WebSocketSession>> sessionsOf,
              Predicate<String> isActive,
              PushNotificationService push) {
        this.objectMapper = objectMapper;
        this.sessionsOf = sessionsOf;
        this.isActive = isActive;
        this.push = push;
    }

    /** Friendship has already been checked by the caller. */
    void handle(WebSocketSession session, String sender, String to, ObjectNode frame) throws IOException {
        String type = frame.get("type").asText();
        String callId = text(frame, "callId");
        frame.put("from", sender);
        boolean reneg = frame.path("reneg").asBoolean(false);

        switch (type) {
            case "call-offer" -> {
                if (reneg) { sendToCallPeer(to, sender, frame); return; }
                WebSocketSession calleePinned = livePin(to);
                if (calleePinned != null) {
                    // Callee is already on a call on some device.
                    session.sendMessage(new TextMessage(endFrame(to, callId, "busy")));
                    return;
                }
                pin(session, sender, to, callId);
                String json = frame.toString();
                pendingOffers.put(to, new PendingOffer(sender, callId, json, Instant.now()));
                sendToAll(to, json);
                if (!isActive.test(to)) {
                    // No names: push payloads pass through the push vendor. The mobile app gets a data-only
                    // message (callId + mode) it can ring from; web and the legacy app a generic notification.
                    push.sendIncomingCall(to, callId, frame.path("mode").asText("video"));
                }
            }
            case "call-answer" -> {
                if (reneg) { sendToCallPeer(to, sender, frame); return; }
                pendingOffers.remove(sender);
                pin(session, sender, to, callId);
                sendToCallPeer(to, sender, frame);
                // Stop the callee's other devices ringing.
                sendToOthers(sender, session, endFrame(to, callId, "answered-elsewhere"));
            }
            case "call-end" -> {
                sendToCallPeerOrAll(to, sender, frame);
                // A decline on one device cancels the ringing on the others.
                sendToOthers(sender, session, endFrame(to, callId, "handled-elsewhere"));
                unpinPair(sender, to);
                PendingOffer pending = pendingOffers.get(to);
                if (pending != null && pending.from().equals(sender)) pendingOffers.remove(to);
                // The callee may be ringing from a push with no socket open: tell its phone to stop.
                if (callId != null && !hasLiveSocket(to)) push.sendCallCancelled(to, callId);
                pending = pendingOffers.get(sender);
                if (pending != null && pending.from().equals(to)) pendingOffers.remove(sender);
            }
            case "call-resume" -> {
                // Socket came back mid-call: pin this device again.
                Pin existing = null;
                WebSocketSession old = pinnedSessionOf.get(sender);
                if (old != null) existing = pins.get(old);
                if (existing == null || existing.peer().equals(to)) pin(session, sender, to, callId);
            }
            default -> sendToCallPeerOrAll(to, sender, frame); // call-ice, call-state, …
        }
    }

    /** Deliver a still-ringing offer to a device that just connected (e.g. woken by push). */
    void onConnect(WebSocketSession session, String username) throws IOException {
        PendingOffer pending = pendingOffers.get(username);
        if (pending == null) return;
        if (Duration.between(pending.at(), Instant.now()).compareTo(RING_WINDOW) > 0) {
            pendingOffers.remove(username);
            return;
        }
        if (livePin(username) != null) return; // already answered on another device
        session.sendMessage(new TextMessage(pending.frame()));
    }

    /** Socket closed: forget its pin, keep the call (see class comment). */
    void onClose(WebSocketSession session, String username) {
        pins.remove(session);
        pinnedSessionOf.remove(username, session);
    }

    // ── routing ────────────────────────────────────────────────────

    private void pin(WebSocketSession session, String user, String peer, String callId) {
        WebSocketSession previous = pinnedSessionOf.put(user, session);
        if (previous != null && previous != session) pins.remove(previous);
        pins.put(session, new Pin(peer, callId));
    }

    private void unpinPair(String a, String b) {
        unpinIfPeer(a, b);
        unpinIfPeer(b, a);
    }

    private void unpinIfPeer(String user, String peer) {
        WebSocketSession s = pinnedSessionOf.get(user);
        if (s == null) return;
        Pin p = pins.get(s);
        if (p == null || p.peer().equals(peer)) {
            pins.remove(s);
            pinnedSessionOf.remove(user, s);
        }
    }

    private boolean hasLiveSocket(String user) {
        return sessionsOf.apply(user).stream().anyMatch(WebSocketSession::isOpen);
    }

    private WebSocketSession livePin(String user) {
        WebSocketSession s = pinnedSessionOf.get(user);
        if (s == null) return null;
        if (!s.isOpen()) return null;
        return s;
    }

    /** To `to`'s pinned device if it's pinned into a call with `sender`. */
    private WebSocketSession pinnedFor(String to, String sender) {
        WebSocketSession s = livePin(to);
        if (s == null) return null;
        Pin p = pins.get(s);
        return p != null && p.peer().equals(sender) ? s : null;
    }

    private void sendToCallPeer(String to, String sender, ObjectNode frame) throws IOException {
        sendToCallPeerOrAll(to, sender, frame);
    }

    private void sendToCallPeerOrAll(String to, String sender, ObjectNode frame) throws IOException {
        WebSocketSession target = pinnedFor(to, sender);
        if (target != null) send(target, frame.toString());
        else sendToAll(to, frame.toString());
    }

    private void sendToAll(String user, String json) throws IOException {
        for (WebSocketSession s : sessionsOf.apply(user)) send(s, json);
    }

    private void sendToOthers(String user, WebSocketSession except, String json) throws IOException {
        for (WebSocketSession s : sessionsOf.apply(user)) if (s != except) send(s, json);
    }

    private static void send(WebSocketSession s, String json) throws IOException {
        if (!s.isOpen()) return;
        synchronized (s) {
            s.sendMessage(new TextMessage(json));
        }
    }

    private String endFrame(String from, String callId, String reason) {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("type", "call-end");
        n.put("from", from);
        if (callId != null) n.put("callId", callId);
        n.put("reason", reason);
        return n.toString();
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}

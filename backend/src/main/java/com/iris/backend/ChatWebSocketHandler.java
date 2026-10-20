package com.iris.backend;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(ChatWebSocketHandler.class);

    // Base64 of one Signal ciphertext. Text + media envelopes are far below this.
    private static final int MAX_ENVELOPE_CHARS = 256 * 1024;

    // Clients that heartbeat ping every ~25 s. A session that has pinged before but
    // goes quiet this long is half-open (NAT timeout, Doze, network switch): close it
    // so presence goes offline and pushes are sent instead of written into the void.
    static final long HEARTBEAT_TIMEOUT_MS = 75_000;
    private static final String LAST_PING = "lastPingAt";
    private static final String PING_FRAME = "{\"type\":\"ping\"}";

    private final MessageRepository messageRepository;
    private final ObjectMapper objectMapper;
    private final PushNotificationService pushNotificationService;
    private final UserStatusService userStatusService;
    private final FriendRequestRepository friendRequestRepository;
    private final SignalKeyService signalKeys;
    private final EnvelopeService envelopes;

    // username → that user's open sessions (could be multiple tabs/devices)
    private final Map<String, Set<WebSocketSession>> sessionsByUser = new ConcurrentHashMap<>();
    private final CallRelay calls;

    public ChatWebSocketHandler(
            MessageRepository messageRepository,
            ObjectMapper objectMapper,
            PushNotificationService pushNotificationService,
            UserStatusService userStatusService,
            FriendRequestRepository friendRequestRepository,
            SignalKeyService signalKeys,
            EnvelopeService envelopes
    ) {
        this.messageRepository = messageRepository;
        this.objectMapper = objectMapper;
        this.pushNotificationService = pushNotificationService;
        this.userStatusService = userStatusService;
        this.friendRequestRepository = friendRequestRepository;
        this.signalKeys = signalKeys;
        this.envelopes = envelopes;
        this.calls = new CallRelay(objectMapper,
            user -> sessionsByUser.getOrDefault(user, Set.of()),
            this::isActive,
            pushNotificationService);
    }

    // Only accepted friends may message, call, or see each other's typing/read state.
    private boolean areFriends(String a, String b) {
        if (a == null || b == null || a.equals(b)) return false;
        return friendRequestRepository.existsAcceptedBetween(a, b);
    }

    private static Integer deviceIdOf(WebSocketSession s) {
        return (Integer) s.getAttributes().get("deviceId");
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        String username = (String) session.getAttributes().get("username");
        session.getAttributes().put("visible", Boolean.TRUE);
        Set<WebSocketSession> userSessions = sessionsByUser
            .computeIfAbsent(username, k -> new CopyOnWriteArraySet<>());
        userSessions.add(session);
        userStatusService.markOnline(username);
        if (userSessions.size() == 1) broadcastPresence(username, true);
        calls.onConnect(session, username);

        if (Boolean.TRUE.equals(session.getAttributes().get("deviceRevoked"))) {
            session.sendMessage(new TextMessage("{\"type\":\"device-revoked\"}"));
            return;
        }
        Integer deviceId = deviceIdOf(session);
        if (deviceId != null) signalKeys.touch(username, deviceId);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String username = (String) session.getAttributes().get("username");
        calls.onClose(session, username);
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions != null) {
            userSessions.remove(session);
            if (userSessions.isEmpty()) {
                sessionsByUser.remove(username);
                userStatusService.markOffline(username);
                broadcastPresence(username, false);
            }
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage textMessage) {
        String payload = textMessage.getPayload();
        // Heartbeats are a fixed frame, matched exactly so they skip JSON parsing.
        if (PING_FRAME.equals(payload)) {
            session.getAttributes().put(LAST_PING, System.currentTimeMillis());
            send(session, "{\"type\":\"pong\"}");
            return;
        }
        // One malformed or failing message must not take the socket down with it
        // (an uncaught exception here closes the session with 1011).
        try {
            dispatch(session, textMessage);
        } catch (Exception e) {
            log.warn("WebSocket message from {} failed: {}", session.getAttributes().get("username"), e.toString());
            String clientId = null;
            try {
                JsonNode root = objectMapper.readTree(payload);
                if (root.hasNonNull("clientId")) clientId = root.get("clientId").asText();
            } catch (Exception ignored) { /* unparseable */ }
            ObjectNode err = objectMapper.createObjectNode();
            err.put("type", "send-error");
            if (clientId != null) err.put("clientId", clientId);
            err.put("reason", "server-error");
            send(session, err.toString());
        }
    }

    private static void send(WebSocketSession session, String frame) {
        try {
            if (session.isOpen()) session.sendMessage(new TextMessage(frame));
        } catch (IOException | IllegalStateException ignored) {
            // closing / concurrent send — the client's heartbeat will notice
        }
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    void closeSilentSessions() {
        long cutoff = System.currentTimeMillis() - HEARTBEAT_TIMEOUT_MS;
        for (Set<WebSocketSession> userSessions : sessionsByUser.values()) {
            for (WebSocketSession s : userSessions) {
                // Only sessions that heartbeat are judged; older clients never ping.
                Long last = (Long) s.getAttributes().get(LAST_PING);
                if (last == null || last >= cutoff) continue;
                try {
                    s.close(CloseStatus.SESSION_NOT_RELIABLE);
                } catch (IOException e) {
                    // afterConnectionClosed still runs and cleans up
                }
            }
        }
    }

    private void dispatch(WebSocketSession session, TextMessage textMessage) throws Exception {
        String sender = (String) session.getAttributes().get("username");

        JsonNode root = objectMapper.readTree(textMessage.getPayload());
        String type = root.has("type") ? root.get("type").asText() : "chat";

        if ("visibility".equals(type)) {
            boolean visible = root.has("state") && "visible".equals(root.get("state").asText());
            session.getAttributes().put("visible", visible);
            return;
        }

        // v2: the client asks for its queued envelopes once its Signal store is ready,
        // so nothing is pushed at a device that can't decrypt (and ack) yet.
        if ("sync".equals(type)) {
            Integer deviceId = deviceIdOf(session);
            if (deviceId == null) return;
            for (EnvelopeService.Pending p : envelopes.pendingFor(sender, deviceId)) {
                session.sendMessage(new TextMessage(envelopeFrame(p.envelope(), p.message())));
            }
            return;
        }

        if ("ack".equals(type)) {
            Integer deviceId = deviceIdOf(session);
            if (deviceId == null || !root.has("ids") || !root.get("ids").isArray()) return;
            List<Long> ids = new ArrayList<>();
            root.get("ids").forEach(n -> { if (n.canConvertToLong()) ids.add(n.asLong()); });
            envelopes.ack(ids, sender, deviceId);
            return;
        }

        // Online status of one contact, answered only for accepted friends.
        if ("presence-query".equals(type)) {
            if (!root.has("user")) return;
            String user = root.get("user").asText();
            if (!areFriends(sender, user)) return;
            session.sendMessage(new TextMessage(presenceFrame(user, userStatusService.isOnline(user))));
            return;
        }

        if ("typing".equals(type)) {
            if (!root.has("to")) return;
            String to = root.get("to").asText();
            if (!areFriends(sender, to)) return;
            ObjectNode forwarded = objectMapper.createObjectNode();
            forwarded.put("type", "typing");
            forwarded.put("from", sender);
            forwarded.put("state", root.has("state") ? root.get("state").asText() : "start");
            sendToUser(to, forwarded.toString());
            return;
        }

        if ("read".equals(type)) {
            // sender has read messages from `from`
            if (!root.has("from")) return;
            String from = root.get("from").asText();
            if (!areFriends(sender, from)) return;
            int updated = messageRepository.markRead(from, sender, Instant.now());
            if (updated > 0) {
                ObjectNode receipt = objectMapper.createObjectNode();
                receipt.put("type", "read-receipt");
                receipt.put("by", sender);
                sendToUser(from, receipt.toString());
            }
            return;
        }

        if (type.startsWith("call-")) {
            if (!root.has("to")) return;
            String to = root.get("to").asText();
            if (!areFriends(sender, to)) return;
            calls.handle(session, sender, to, (ObjectNode) root);
            return;
        }

        // ── chat message ──
        IncomingMessage incoming = objectMapper.treeToValue(root, IncomingMessage.class);

        if (incoming.to() == null || incoming.to().isBlank()) return;
        if (!areFriends(sender, incoming.to())) return;

        if (incoming.isV2()) {
            handleV2(session, sender, incoming);
            return;
        }

        // ── legacy (v1, RSA-wrapped) message ──
        // TODO(remove-legacy): once every client has a Signal device, drop this
        // branch and reject v1 sends; history stays readable via MessageController.
        boolean hasText = incoming.content() != null && !incoming.content().isBlank();
        boolean hasMedia = incoming.mediaId() != null && !incoming.mediaId().isBlank();
        if (!hasText && !hasMedia) return;

        Message saved = messageRepository.save(new Message(
            sender, incoming.to(),
            hasText ? incoming.content() : "",
            incoming.encryptedKeyForSender(), incoming.encryptedKeyForRecipient(),
            hasMedia ? incoming.mediaId() : null,
            hasMedia ? incoming.mimeType() : null,
            hasMedia && incoming.viewOnceFlag(),
            incoming.replyToId()
        ));

        String payload = objectMapper.writeValueAsString(toOutgoing(saved));

        java.util.Set<String> targets = new java.util.HashSet<>();
        targets.add(incoming.to());
        targets.add(sender);
        for (String username : targets) sendToUser(username, payload);

        if (!isActive(incoming.to())) {
            // Generic text: push payloads pass through the browser vendor's push service.
            pushNotificationService.sendToUser(incoming.to(), "Iris", "New message");
        }
    }

    /**
     * v2 (Signal protocol): the client sends one ciphertext per target device. The
     * server checks the fan-out against the device registry (refusing with the
     * missing/extra devices if the client's view is stale), stores metadata + the
     * envelopes atomically, and delivers each envelope only to its own device.
     */
    private void handleV2(WebSocketSession session, String sender, IncomingMessage incoming) throws IOException {
        String clientId = incoming.clientId();
        Integer senderDeviceId = deviceIdOf(session);
        if (senderDeviceId == null) {
            sendError(session, clientId, "no-device", null);
            return;
        }
        List<IncomingMessage.Envelope> provided = incoming.envelopes() == null ? List.of() : incoming.envelopes();
        for (IncomingMessage.Envelope e : provided) {
            if (e.user() == null || e.deviceId() == null || e.body() == null || e.body().length() > MAX_ENVELOPE_CHARS
                    || e.type() == null || (e.type() != 1 && e.type() != 3)) {
                sendError(session, clientId, "bad-envelope", null);
                return;
            }
        }

        List<Integer> recipientDevices = signalKeys.deviceIds(incoming.to());
        if (recipientDevices.isEmpty()) {
            // Recipient has no Signal devices — the client falls back to a v1 send.
            sendError(session, clientId, "recipient-not-v2", null);
            return;
        }
        Set<EnvelopeFanout.Address> expected = EnvelopeFanout.expectedTargets(
            sender, senderDeviceId, signalKeys.deviceIds(sender), incoming.to(), recipientDevices);
        EnvelopeFanout.Result fanout = EnvelopeFanout.check(expected,
            provided.stream().map(e -> new EnvelopeFanout.Address(e.user(), e.deviceId())).toList());
        if (!fanout.ok()) {
            sendError(session, clientId, "device-mismatch", fanout);
            return;
        }

        boolean hasMedia = incoming.mediaId() != null && !incoming.mediaId().isBlank();
        EnvelopeService.Stored stored = envelopes.saveV2(
            Message.v2(sender, senderDeviceId, incoming.to(),
                hasMedia ? incoming.mediaId() : null,
                hasMedia ? incoming.mimeType() : null,
                hasMedia && incoming.viewOnceFlag(),
                incoming.replyToId()),
            provided);

        for (MessageEnvelope env : stored.envelopes()) {
            sendToDevice(env.getTargetUser(), env.getTargetDeviceId(), envelopeFrame(env, stored.message()));
        }

        ObjectNode sent = objectMapper.createObjectNode();
        sent.put("type", "sent");
        sent.put("clientId", clientId);
        sent.set("message", objectMapper.valueToTree(toOutgoing(stored.message())));
        session.sendMessage(new TextMessage(sent.toString()));

        if (!isActive(incoming.to())) {
            pushNotificationService.sendToUser(incoming.to(), "Iris", "New message");
        }
    }

    private String envelopeFrame(MessageEnvelope env, Message message) {
        ObjectNode frame = objectMapper.createObjectNode();
        frame.put("type", "envelope");
        frame.put("envelopeId", env.getId());
        frame.put("envType", env.getType());
        frame.put("body", env.getBody());
        frame.set("message", objectMapper.valueToTree(toOutgoing(message)));
        return frame.toString();
    }

    private void sendError(WebSocketSession session, String clientId, String reason, EnvelopeFanout.Result fanout)
            throws IOException {
        ObjectNode err = objectMapper.createObjectNode();
        err.put("type", "send-error");
        err.put("clientId", clientId);
        err.put("reason", reason);
        if (fanout != null) {
            err.set("missing", addresses(fanout.missing()));
            List<EnvelopeFanout.Address> extra = new ArrayList<>(fanout.extra());
            extra.addAll(fanout.duplicates());
            err.set("extra", addresses(extra));
        }
        session.sendMessage(new TextMessage(err.toString()));
    }

    private ArrayNode addresses(List<EnvelopeFanout.Address> list) {
        ArrayNode arr = objectMapper.createArrayNode();
        for (EnvelopeFanout.Address a : list) {
            ObjectNode n = objectMapper.createObjectNode();
            n.put("user", a.user());
            n.put("deviceId", a.deviceId());
            arr.add(n);
        }
        return arr;
    }

    private String presenceFrame(String user, boolean online) {
        ObjectNode n = objectMapper.createObjectNode();
        n.put("type", "presence");
        n.put("user", user);
        n.put("online", online);
        return n.toString();
    }

    /** Tell a user's friends that their first socket opened / last socket closed. */
    private void broadcastPresence(String username, boolean online) {
        String frame = presenceFrame(username, online);
        for (FriendRequest fr : friendRequestRepository.findAcceptedByUser(username)) {
            String friend = fr.getFromUser().equals(username) ? fr.getToUser() : fr.getFromUser();
            try {
                sendToUser(friend, frame);
            } catch (IOException ignored) {
                // friend's socket went away mid-send
            }
        }
    }

    /** Best-effort nudge to every open session of a user, e.g. {"type":"friends-changed"}. */
    public void notifyUser(String username, String type) {
        try {
            sendToUser(username, objectMapper.createObjectNode().put("type", type).toString());
        } catch (IOException ignored) {
            // client re-fetches on its next load anyway
        }
    }

    /** Called after a device is removed: tell its open sockets, then drop them. */
    public void revokeDevice(String username, int deviceId) {
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions == null) return;
        for (WebSocketSession s : userSessions) {
            Integer d = deviceIdOf(s);
            if (d != null && d == deviceId && s.isOpen()) {
                try {
                    s.sendMessage(new TextMessage("{\"type\":\"device-revoked\"}"));
                    s.close(CloseStatus.POLICY_VIOLATION);
                } catch (IOException ignored) {
                    // socket already gone
                }
            }
        }
    }

    private boolean isActive(String username) {
        return sessionsByUser.getOrDefault(username, Set.of()).stream()
            .anyMatch(s -> s.isOpen()
                && Boolean.TRUE.equals(s.getAttributes().getOrDefault("visible", Boolean.TRUE)));
    }

    static OutgoingMessage toOutgoing(Message m) {
        return OutgoingMessage.of(m);
    }

    private void sendToUser(String username, String payload) throws IOException {
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions == null) return;
        for (WebSocketSession s : userSessions) {
            if (s.isOpen()) s.sendMessage(new TextMessage(payload));
        }
    }

    // A device may be open in more than one tab; every tab of that device gets it,
    // and they converge because the first ack deletes the envelope server-side.
    private void sendToDevice(String username, int deviceId, String payload) throws IOException {
        Set<WebSocketSession> userSessions = sessionsByUser.get(username);
        if (userSessions == null) return;
        for (WebSocketSession s : userSessions) {
            Integer d = deviceIdOf(s);
            if (d != null && d == deviceId && s.isOpen()) s.sendMessage(new TextMessage(payload));
        }
    }

}

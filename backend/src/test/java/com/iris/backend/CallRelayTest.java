package com.iris.backend;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class CallRelayTest {

    private final ObjectMapper json = JsonMapper.builder().build();
    private final Map<String, Set<WebSocketSession>> sessions = new HashMap<>();
    private final Map<WebSocketSession, List<String>> inbox = new HashMap<>();
    private final Set<String> active = new LinkedHashSet<>();
    private PushNotificationService push;
    private CallRelay relay;

    @BeforeEach
    void setUp() {
        push = mock(PushNotificationService.class);
        relay = new CallRelay(json, u -> sessions.getOrDefault(u, Set.of()), active::contains, push);
    }

    private WebSocketSession device(String user) throws Exception {
        WebSocketSession s = mock(WebSocketSession.class);
        when(s.isOpen()).thenReturn(true);
        List<String> received = new ArrayList<>();
        inbox.put(s, received);
        doAnswer(inv -> {
            WebSocketMessage<?> m = inv.getArgument(0);
            received.add(((TextMessage) m).getPayload());
            return null;
        }).when(s).sendMessage(any());
        sessions.computeIfAbsent(user, k -> new LinkedHashSet<>()).add(s);
        active.add(user);
        return s;
    }

    private ObjectNode frame(String type, String to, String callId) {
        ObjectNode n = json.createObjectNode();
        n.put("type", type);
        n.put("to", to);
        n.put("callId", callId);
        return n;
    }

    private List<String> types(WebSocketSession s) {
        return inbox.get(s).stream().map(p -> json.readTree(p).get("type").asText()).toList();
    }

    private String lastReason(WebSocketSession s) {
        List<String> got = inbox.get(s);
        return json.readTree(got.get(got.size() - 1)).path("reason").asText();
    }

    @Test
    void offerRingsEveryDeviceOfTheCallee() throws Exception {
        WebSocketSession alice = device("alice");
        WebSocketSession bobPhone = device("bob");
        WebSocketSession bobLaptop = device("bob");

        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));

        assertEquals(List.of("call-offer"), types(bobPhone));
        assertEquals(List.of("call-offer"), types(bobLaptop));
        assertEquals("alice", json.readTree(inbox.get(bobPhone).get(0)).get("from").asText());
    }

    @Test
    void answeringPinsTheCallAndStopsTheOtherDevicesRinging() throws Exception {
        WebSocketSession alice = device("alice");
        WebSocketSession bobPhone = device("bob");
        WebSocketSession bobLaptop = device("bob");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));

        relay.handle(bobPhone, "bob", "alice", frame("call-answer", "alice", "c1"));
        assertEquals(List.of("call-answer"), types(alice));
        assertEquals(List.of("call-offer", "call-end"), types(bobLaptop));
        assertEquals("answered-elsewhere", lastReason(bobLaptop));

        // From now on signals only reach the answering device.
        relay.handle(alice, "alice", "bob", frame("call-ice", "bob", "c1"));
        assertEquals(List.of("call-offer", "call-ice"), types(bobPhone));
        assertEquals(List.of("call-offer", "call-end"), types(bobLaptop));
    }

    @Test
    void aUserAlreadyInACallIsBusy() throws Exception {
        WebSocketSession alice = device("alice");
        WebSocketSession bob = device("bob");
        WebSocketSession carol = device("carol");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));
        relay.handle(bob, "bob", "alice", frame("call-answer", "alice", "c1"));

        relay.handle(carol, "carol", "bob", frame("call-offer", "bob", "c2"));

        assertEquals(List.of("call-end"), types(carol));
        assertEquals("busy", lastReason(carol));
        assertEquals(List.of("call-offer"), types(bob)); // bob's live call is untouched
    }

    @Test
    void declineOnOneDeviceCancelsTheOthers() throws Exception {
        WebSocketSession alice = device("alice");
        WebSocketSession bobPhone = device("bob");
        WebSocketSession bobLaptop = device("bob");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));

        ObjectNode decline = frame("call-end", "alice", "c1");
        decline.put("reason", "declined");
        relay.handle(bobPhone, "bob", "alice", decline);

        assertEquals("declined", lastReason(alice));
        assertEquals("handled-elsewhere", lastReason(bobLaptop));
    }

    @Test
    void offlineCalleeIsPushedAndGetsTheOfferWhenItConnects() throws Exception {
        WebSocketSession alice = device("alice");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));
        verify(push).sendIncomingCall("bob", "c1", "video");

        WebSocketSession bob = device("bob");
        relay.onConnect(bob, "bob");
        assertEquals(List.of("call-offer"), types(bob));
    }

    @Test
    void incomingCallPushCarriesTheCallModeAndNoNames() throws Exception {
        WebSocketSession alice = device("alice");
        ObjectNode offer = frame("call-offer", "bob", "c7");
        offer.put("mode", "audio");
        relay.handle(alice, "alice", "bob", offer);
        verify(push).sendIncomingCall("bob", "c7", "audio");
        verify(push, never()).sendToUser(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    void callerCancellingWhileCalleeHasNoSocketSendsCallCancelled() throws Exception {
        WebSocketSession alice = device("alice");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));
        relay.handle(alice, "alice", "bob", frame("call-end", "bob", "c1"));
        verify(push).sendCallCancelled("bob", "c1");
    }

    @Test
    void noCallCancelledPushWhenTheCalleeHasALiveSocket() throws Exception {
        WebSocketSession alice = device("alice");
        device("bob");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));
        relay.handle(alice, "alice", "bob", frame("call-end", "bob", "c1"));
        verify(push, never()).sendCallCancelled(anyString(), anyString());
    }

    @Test
    void cancelledOfferIsNotReplayedOnConnect() throws Exception {
        WebSocketSession alice = device("alice");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));
        relay.handle(alice, "alice", "bob", frame("call-end", "bob", "c1"));

        WebSocketSession bob = device("bob");
        relay.onConnect(bob, "bob");
        assertTrue(types(bob).isEmpty());
    }

    @Test
    void reconnectingDeviceResumesItsPin() throws Exception {
        WebSocketSession alice = device("alice");
        WebSocketSession bob = device("bob");
        relay.handle(alice, "alice", "bob", frame("call-offer", "bob", "c1"));
        relay.handle(bob, "bob", "alice", frame("call-answer", "alice", "c1"));

        // bob's socket drops and comes back as a new session
        relay.onClose(bob, "bob");
        sessions.get("bob").remove(bob);
        WebSocketSession bobAgain = device("bob");
        WebSocketSession bobOther = device("bob");
        relay.handle(bobAgain, "bob", "alice", frame("call-resume", "alice", "c1"));

        relay.handle(alice, "alice", "bob", frame("call-ice", "bob", "c1"));
        assertEquals(List.of("call-ice"), types(bobAgain));
        assertTrue(types(bobOther).isEmpty());
    }
}

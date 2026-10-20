package com.iris.backend;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class FcmMessagePushTest {

    private static MessageEnvelope env(long id, int deviceId, int type, String body) throws Exception {
        MessageEnvelope e = new MessageEnvelope(42L, "bob", deviceId, type, body);
        Field f = MessageEnvelope.class.getDeclaredField("id");
        f.setAccessible(true);
        f.set(e, id);
        return e;
    }

    @Test
    void mobileTokenWithDeviceGetsOnlyItsOwnCiphertextAndOpaqueIds() throws Exception {
        List<MessageEnvelope> envs = List.of(env(7, 1, 3, "AAA-device1"), env(8, 2, 1, "BBB-device2"));
        FcmSender.MessagePushPlan p = FcmSender.planMessage(FcmSender.MOBILE_APP_ID, 2, 42L, envs);
        assertTrue(p.dataOnly());
        assertEquals(Map.of("type", "msg", "mid", "42", "eid", "8", "et", "1", "env", "BBB-device2"), p.data(),
            "no sender, no group, no text, no other device's envelope");
        assertNull(p.collapseKey(), "each envelope push is distinct; collapsing would hide ciphertexts");
    }

    @Test
    void oversizedEnvelopeBecomesAWakeUp() throws Exception {
        String big = "x".repeat(FcmSender.MAX_DATA_BYTES);
        FcmSender.MessagePushPlan p = FcmSender.planMessage(FcmSender.MOBILE_APP_ID, 1, 42L, List.of(env(7, 1, 1, big)));
        assertTrue(p.dataOnly());
        assertEquals(Map.of("type", "msg-wake"), p.data());
        assertEquals("msg-wake", p.collapseKey());
    }

    @Test
    void justUnderTheLimitStillCarriesTheEnvelope() throws Exception {
        // type+msg, mid+42, eid+7, et+1, env+body
        int overhead = "type".length() + "msg".length() + "mid".length() + 2 + "eid".length() + 1 + "et".length() + 1 + "env".length();
        String body = "y".repeat(FcmSender.MAX_DATA_BYTES - overhead);
        FcmSender.MessagePushPlan p = FcmSender.planMessage(FcmSender.MOBILE_APP_ID, 1, 42L, List.of(env(7, 1, 1, body)));
        assertEquals("msg", p.data().get("type"));
        assertEquals(FcmSender.MAX_DATA_BYTES, FcmSender.dataBytes(p.data()));
    }

    @Test
    void deviceWithoutACopyIsWokenToSync() throws Exception {
        FcmSender.MessagePushPlan p = FcmSender.planMessage(FcmSender.MOBILE_APP_ID, 9, 42L, List.of(env(7, 1, 1, "A")));
        assertTrue(p.dataOnly());
        assertEquals("msg-wake", p.data().get("type"));
    }

    @Test
    void legacyUnknownAndDevicelessTokensKeepTheVisibleNotification() throws Exception {
        List<MessageEnvelope> envs = List.of(env(7, 1, 1, "A"));
        assertFalse(FcmSender.planMessage(null, 1, 42L, envs).dataOnly());              // pre-field client
        assertFalse(FcmSender.planMessage("com.iris.chat", 1, 42L, envs).dataOnly());   // legacy Capacitor app
        assertFalse(FcmSender.planMessage(FcmSender.MOBILE_APP_ID, null, 42L, envs).dataOnly()); // older mobile build
        assertFalse(FcmSender.planMessage(FcmSender.MOBILE_APP_ID, 1, 42L, null).dataOnly(),
            "a legacy v1 message has no envelope to carry");
    }

    @Test
    void socialEventsAreDataOnlyAndNameless() {
        FcmSender.MessagePushPlan req = FcmSender.planSocial(FcmSender.MOBILE_APP_ID, 1, FcmSender.SocialEvent.REQUEST);
        assertTrue(req.dataOnly());
        assertEquals(Map.of("type", "friend-request"), req.data());
        assertEquals(Map.of("type", "friend-accepted"),
            FcmSender.planSocial(FcmSender.MOBILE_APP_ID, 1, FcmSender.SocialEvent.ACCEPTED).data());
        assertFalse(FcmSender.planSocial("com.iris.chat", 1, FcmSender.SocialEvent.REQUEST).dataOnly());
        assertFalse(FcmSender.planSocial(FcmSender.MOBILE_APP_ID, null, FcmSender.SocialEvent.REQUEST).dataOnly());
    }
}

package com.iris.backend;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class FcmCallPushTest {

    @Test
    void mobileAppTokensGetADataOnlyCallPushWithoutNames() {
        FcmSender.CallPushPlan p = FcmSender.planIncomingCall(FcmSender.MOBILE_APP_ID, "c1", "audio");
        assertTrue(p.dataOnly());
        assertEquals("incoming-call", p.data().get("type"));
        assertEquals("c1", p.data().get("callId"));
        assertEquals("audio", p.data().get("mode"));
        assertEquals(3, p.data().size(), "no caller name, no title, no body");
    }

    @Test
    void modeDefaultsToVideoForUnknownValues() {
        assertEquals("video", FcmSender.planIncomingCall(FcmSender.MOBILE_APP_ID, "c1", "weird").data().get("mode"));
        assertEquals("video", FcmSender.planIncomingCall(FcmSender.MOBILE_APP_ID, "c1", null).data().get("mode"));
    }

    @Test
    void legacyAndUnknownTokensKeepTheVisibleNotification() {
        assertFalse(FcmSender.planIncomingCall(null, "c1", "video").dataOnly());          // pre-field client
        assertFalse(FcmSender.planIncomingCall("com.iris.chat", "c1", "video").dataOnly()); // legacy Capacitor app
    }

    @Test
    void callCancelledIsMobileOnly() {
        FcmSender.CallPushPlan mobile = FcmSender.planCallCancelled(FcmSender.MOBILE_APP_ID, "c1");
        assertTrue(mobile.dataOnly());
        assertEquals("call-cancelled", mobile.data().get("type"));
        assertEquals("c1", mobile.data().get("callId"));
        assertFalse(FcmSender.planCallCancelled(null, "c1").dataOnly());
        assertFalse(FcmSender.planCallCancelled("com.iris.chat", "c1").dataOnly());
        assertFalse(FcmSender.planCallCancelled(FcmSender.MOBILE_APP_ID, " ").dataOnly());
    }

    @Test
    void appIdIsSanitised() {
        assertEquals("com.iris.chat.mobile", PushController.sanitizeApp(" com.iris.chat.mobile "));
        assertNull(PushController.sanitizeApp(null));
        assertNull(PushController.sanitizeApp("bad app<script>"));
        assertNull(PushController.sanitizeApp(""));
    }
}

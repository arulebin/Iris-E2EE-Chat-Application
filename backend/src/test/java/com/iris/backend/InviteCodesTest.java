package com.iris.backend;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.*;

class InviteCodesTest {

    @Test
    void generatedCodesUseTheCrockfordAlphabet() {
        for (int i = 0; i < 200; i++) {
            String code = InviteCodes.generate();
            assertEquals(InviteCodes.LENGTH, code.length());
            assertTrue(code.chars().allMatch(c -> InviteCodes.ALPHABET.indexOf(c) >= 0), code);
            assertEquals(code, InviteCodes.normalize(code));
        }
    }

    @Test
    void normalizeAcceptsFormattingTyposAndUrls() {
        assertEquals("ABCDE01234", InviteCodes.normalize("abcde-o1234"));
        assertEquals("ABCDE11234", InviteCodes.normalize(" ABCDE IL234 "));
        assertEquals("ABCDE01234", InviteCodes.normalize("https://iris-chat-web.vercel.app/?add=ABCDE-01234&x=1"));
        assertNull(InviteCodes.normalize("short"));
        assertNull(InviteCodes.normalize("ABCDE-0123U"), "U is not in the alphabet");
        assertNull(InviteCodes.normalize(null));
        assertEquals("ABCDE-01234", InviteCodes.format("ABCDE01234"));
    }

    @Test
    void rateLimiterCapsPerUserAndTrustsForwardedForOnlyFromTheProxy() {
        InviteRateLimiter limiter = new InviteRateLimiter();
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("172.18.0.3");                 // Caddy on the compose network
        req.addHeader("X-Forwarded-For", "203.0.113.7, 172.18.0.3");
        assertEquals("203.0.113.7", InviteRateLimiter.clientIp(req));

        for (int i = 0; i < InviteRateLimiter.PER_USER; i++) assertTrue(limiter.tryAcquire("mallory", req));
        assertFalse(limiter.tryAcquire("mallory", req), "user limit reached");

        MockHttpServletRequest direct = new MockHttpServletRequest();
        direct.setRemoteAddr("198.51.100.9");             // not our proxy: header ignored
        direct.addHeader("X-Forwarded-For", "1.2.3.4");
        assertEquals("198.51.100.9", InviteRateLimiter.clientIp(direct));
    }
}

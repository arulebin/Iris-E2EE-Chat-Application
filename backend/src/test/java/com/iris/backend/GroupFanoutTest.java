package com.iris.backend;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class GroupFanoutTest {

    private static EnvelopeFanout.Address a(String user, int device) {
        return new EnvelopeFanout.Address(user, device);
    }

    private static Map<String, List<Integer>> roster() {
        Map<String, List<Integer>> m = new LinkedHashMap<>();
        m.put("alice", List.of(1, 2));   // sender, sending from device 1
        m.put("bob", List.of(1));
        m.put("carol", List.of(1, 3));
        m.put("dave", List.of());        // legacy-only member: nothing to send to
        return m;
    }

    @Test
    void expectsEveryMemberDeviceExceptTheSendingOne() {
        Set<EnvelopeFanout.Address> expected = EnvelopeFanout.expectedGroupTargets("alice", 1, roster());
        assertThat(expected).containsExactlyInAnyOrder(a("alice", 2), a("bob", 1), a("carol", 1), a("carol", 3));
    }

    @Test
    void completeFanoutPasses() {
        Set<EnvelopeFanout.Address> expected = EnvelopeFanout.expectedGroupTargets("alice", 1, roster());
        assertThat(EnvelopeFanout.check(expected,
            List.of(a("bob", 1), a("carol", 3), a("carol", 1), a("alice", 2))).ok()).isTrue();
    }

    @Test
    void removedMemberAndMissingDeviceAreReported() {
        Set<EnvelopeFanout.Address> expected = EnvelopeFanout.expectedGroupTargets("alice", 1, roster());
        // Stale client: still encrypts to a removed member (mallory) and doesn't know carol's device 3.
        EnvelopeFanout.Result r = EnvelopeFanout.check(expected,
            List.of(a("bob", 1), a("carol", 1), a("alice", 2), a("mallory", 1)));
        assertThat(r.ok()).isFalse();
        assertThat(r.extra()).containsExactly(a("mallory", 1));
        assertThat(r.missing()).containsExactly(a("carol", 3));
    }

    @Test
    void sendingDeviceMustNotReceiveItsOwnCopy() {
        Set<EnvelopeFanout.Address> expected = EnvelopeFanout.expectedGroupTargets("alice", 1, roster());
        EnvelopeFanout.Result r = EnvelopeFanout.check(expected,
            List.of(a("bob", 1), a("carol", 1), a("carol", 3), a("alice", 2), a("alice", 1)));
        assertThat(r.extra()).containsExactly(a("alice", 1));
    }
}

package com.iris.backend;

import com.iris.backend.EnvelopeFanout.Address;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class EnvelopeFanoutTest {

    private static Address a(String user, int device) {
        return new Address(user, device);
    }

    @Test
    void expectedTargetsCoverRecipientAndSendersOtherDevicesButNotTheSendingOne() {
        Set<Address> expected = EnvelopeFanout.expectedTargets("alice", 2, List.of(1, 2, 3), "bob", List.of(1, 4));
        assertEquals(Set.of(a("bob", 1), a("bob", 4), a("alice", 1), a("alice", 3)), expected);
    }

    @Test
    void singleDeviceEachSideNeedsOnlyTheRecipient() {
        Set<Address> expected = EnvelopeFanout.expectedTargets("alice", 1, List.of(1), "bob", List.of(1));
        assertEquals(Set.of(a("bob", 1)), expected);
    }

    @Test
    void exactMatchIsAccepted() {
        Set<Address> expected = Set.of(a("bob", 1), a("alice", 3));
        assertTrue(EnvelopeFanout.check(expected, List.of(a("alice", 3), a("bob", 1))).ok());
    }

    @Test
    void reportsMissingDevices() {
        Set<Address> expected = Set.of(a("bob", 1), a("bob", 2));
        var result = EnvelopeFanout.check(expected, List.of(a("bob", 1)));
        assertFalse(result.ok());
        assertEquals(List.of(a("bob", 2)), result.missing());
        assertTrue(result.extra().isEmpty());
    }

    @Test
    void reportsRemovedDevicesAndStrangersAsExtra() {
        Set<Address> expected = Set.of(a("bob", 2));
        var result = EnvelopeFanout.check(expected, List.of(a("bob", 2), a("bob", 1), a("mallory", 1)));
        assertFalse(result.ok());
        assertEquals(List.of(a("bob", 1), a("mallory", 1)), result.extra());
        assertTrue(result.missing().isEmpty());
    }

    @Test
    void sendingToYourOwnSendingDeviceIsExtra() {
        Set<Address> expected = EnvelopeFanout.expectedTargets("alice", 1, List.of(1), "bob", List.of(1));
        var result = EnvelopeFanout.check(expected, List.of(a("bob", 1), a("alice", 1)));
        assertEquals(List.of(a("alice", 1)), result.extra());
    }

    @Test
    void duplicateEnvelopesAreRejected() {
        Set<Address> expected = Set.of(a("bob", 1));
        var result = EnvelopeFanout.check(expected, List.of(a("bob", 1), a("bob", 1)));
        assertFalse(result.ok());
        assertEquals(List.of(a("bob", 1)), result.duplicates());
    }

    @Test
    void recipientWithNoDevicesExpectsOnlySenderSync() {
        Set<Address> expected = EnvelopeFanout.expectedTargets("alice", 1, List.of(1, 2), "bob", List.of());
        assertEquals(Set.of(a("alice", 2)), expected);
    }
}

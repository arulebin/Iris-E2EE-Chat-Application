package com.iris.backend;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Sesame-lite device fan-out check for one v2 message.
 *
 * A v2 message must carry exactly one envelope for every registered device of the
 * recipient AND every one of the sender's other devices (so they stay in sync) —
 * never for the sending device itself, never for anyone else. If the sender's view
 * of the device lists is stale the message is refused with the missing/extra
 * devices, the client refreshes its sessions and retries. Pure logic, no I/O.
 */
public final class EnvelopeFanout {

    public record Address(String user, int deviceId) { }

    public record Result(List<Address> missing, List<Address> extra, List<Address> duplicates) {
        public boolean ok() {
            return missing.isEmpty() && extra.isEmpty() && duplicates.isEmpty();
        }
    }

    private EnvelopeFanout() { }

    /** Every device that must receive a copy: all recipient devices + sender's devices except the sending one. */
    public static Set<Address> expectedTargets(String sender, int senderDeviceId,
                                               Collection<Integer> senderDevices,
                                               String recipient, Collection<Integer> recipientDevices) {
        Set<Address> expected = new LinkedHashSet<>();
        for (int d : recipientDevices) expected.add(new Address(recipient, d));
        for (int d : senderDevices) {
            if (d != senderDeviceId) expected.add(new Address(sender, d));
        }
        return expected;
    }

    public static Result check(Set<Address> expected, List<Address> provided) {
        Set<Address> seen = new HashSet<>();
        List<Address> duplicates = new ArrayList<>();
        List<Address> extra = new ArrayList<>();
        for (Address a : provided) {
            if (!seen.add(a)) {
                duplicates.add(a);
            } else if (!expected.contains(a)) {
                extra.add(a);
            }
        }
        List<Address> missing = new ArrayList<>();
        for (Address a : expected) {
            if (!seen.contains(a)) missing.add(a);
        }
        return new Result(missing, extra, duplicates);
    }
}

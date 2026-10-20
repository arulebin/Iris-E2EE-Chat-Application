package com.iris.backend;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
@Import(PrivacyService.class)
class PrivacyServiceTest {

    @Autowired UserRepository users;
    @Autowired FriendRequestRepository friends;
    @Autowired UserBlockRepository blocks;
    @Autowired PrivacyService privacy;

    User alice, bob, carol;

    @BeforeEach
    void setUp() {
        alice = users.save(new User("alice", "x"));
        bob = users.save(new User("bob", "x"));
        carol = users.save(new User("carol", "x"));
        carol.setPreferredName("Carol Private");
        carol.setAvatarUrl("prof_c.png");
        carol.setPrivateProfile(true);
        users.save(carol);
    }

    private void befriend(String a, String b) {
        FriendRequest fr = new FriendRequest(a, b);
        fr.setStatus(FriendRequest.Status.ACCEPTED);
        friends.save(fr);
    }

    @Test
    void searchSkipsPrivateProfilesSelfAndBlocked() {
        assertEquals(java.util.List.of("bob"),
                privacy.search("alice", "").stream().map(User::getUsername).toList());
        assertTrue(privacy.search("alice", "carol").isEmpty(), "private profile must not be searchable");

        privacy.block("bob", "alice");
        assertTrue(privacy.search("alice", "bob").isEmpty(), "someone who blocked me disappears from search");
    }

    @Test
    void privateProfileIsRedactedForStrangersButVisibleToFriends() {
        UserProfileDto stranger = privacy.profileFor("alice", carol);
        assertEquals("carol", stranger.username());
        assertNull(stranger.preferredName());
        assertNull(stranger.avatarUrl());
        assertNull(stranger.shareId());
        assertTrue(privacy.visibleByUsername("alice", "carol").isEmpty());

        befriend("alice", "carol");
        UserProfileDto friend = privacy.profileFor("alice", carol);
        assertEquals("Carol Private", friend.preferredName());
        assertEquals("prof_c.png", friend.avatarUrl());
        assertTrue(privacy.visibleByUsername("alice", "carol").isPresent());

        // Self always sees everything, including the share id.
        assertNotNull(privacy.profileFor("carol", carol).shareId());
    }

    @Test
    void shareIdLookupOnlyReachesPublicProfiles() {
        assertTrue(privacy.byShareId(bob.getShareId()).isPresent());
        assertTrue(privacy.byShareId(carol.getShareId()).isEmpty());
    }

    @Test
    void inviteCodeLookupNormalizesInputAndRotationKillsTheOldCode() {
        String code = privacy.ensureInviteCode(carol);
        assertEquals(code, privacy.ensureInviteCode(carol), "ensure is idempotent");

        String typed = InviteCodes.format(code).toLowerCase();
        assertEquals("carol", privacy.byInviteCode(typed).orElseThrow().getUsername());
        assertEquals("carol", privacy.byInviteCode("https://iris.example/?add=" + code).orElseThrow().getUsername());

        String rotated = privacy.rotateInviteCode(carol);
        assertNotEquals(code, rotated);
        assertTrue(privacy.byInviteCode(code).isEmpty(), "old code must stop working");
        assertTrue(privacy.byInviteCode(rotated).isPresent());

        carol.setInvitesEnabled(false);
        users.save(carol);
        assertTrue(privacy.byInviteCode(rotated).isEmpty(), "disabled invites resolve to nothing");
    }

    @Test
    void blockCutsTheFriendshipGateAndUnblockRestoresIt() {
        befriend("alice", "bob");
        assertTrue(friends.existsAcceptedUnblockedBetween("alice", "bob"));

        privacy.block("alice", "bob");
        assertFalse(friends.existsAcceptedUnblockedBetween("alice", "bob"));
        assertFalse(friends.existsAcceptedUnblockedBetween("bob", "alice"), "gate is symmetric");
        assertEquals(java.util.List.of("bob"), privacy.blockedBy("alice"));

        assertTrue(privacy.unblock("alice", "bob"));
        assertTrue(friends.existsAcceptedUnblockedBetween("alice", "bob"));
        assertFalse(privacy.unblock("alice", "bob"), "second unblock is a no-op");
    }

    @Test
    void blockingRejectsTheirPendingRequest() {
        friends.save(new FriendRequest("bob", "alice"));
        privacy.block("alice", "bob");
        assertEquals(FriendRequest.Status.REJECTED,
                friends.findByFromUserAndToUser("bob", "alice").orElseThrow().getStatus());
    }
}

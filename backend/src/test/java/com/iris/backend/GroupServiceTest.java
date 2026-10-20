package com.iris.backend;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Membership authorization rules (repositories mocked; the rules are the unit). */
class GroupServiceTest {

    private GroupChatRepository groups;
    private GroupMemberRepository members;
    private GroupEventRepository events;
    private FriendRequestRepository friends;
    private UserRepository users;
    private GroupService service;

    private final GroupChat group = new GroupChat("g1", "Weekend", "alice");

    @BeforeEach
    void setUp() {
        groups = mock(GroupChatRepository.class);
        members = mock(GroupMemberRepository.class);
        events = mock(GroupEventRepository.class);
        friends = mock(FriendRequestRepository.class);
        users = mock(UserRepository.class);
        service = new GroupService(groups, members, events, friends, users);

        when(groups.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(members.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(groups.findById("g1")).thenReturn(Optional.of(group));
        when(users.findByUsername(anyString())).thenAnswer(inv -> Optional.of(user(inv.getArgument(0))));
    }

    private static User user(String name) {
        User u = mock(User.class);
        when(u.getUsername()).thenReturn(name);
        return u;
    }

    private GroupMember member(String name, GroupMember.Role role) {
        GroupMember m = new GroupMember("g1", name, role);
        when(members.findByGroupIdAndUsername("g1", name)).thenReturn(Optional.of(m));
        when(members.existsByGroupIdAndUsername("g1", name)).thenReturn(true);
        return m;
    }

    private void roster(GroupMember... list) {
        when(members.findByGroupIdOrderByJoinedAtAsc("g1")).thenReturn(new ArrayList<>(List.of(list)));
    }

    private static HttpStatus status(Throwable t) {
        return HttpStatus.valueOf(((ResponseStatusException) t).getStatusCode().value());
    }

    // ── create ──────────────────────────────────────────────────────

    @Test
    void createRejectsMembersWhoAreNotFriends() {
        when(friends.existsAcceptedBetween("alice", "bob")).thenReturn(true);
        when(friends.existsAcceptedBetween("alice", "mallory")).thenReturn(false);

        assertThatThrownBy(() -> service.create("alice", "Weekend", List.of("bob", "mallory")))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.BAD_REQUEST))
            .hasMessageContaining("mallory");
        verify(groups, never()).save(any());
    }

    @Test
    void createMakesCreatorAdminAndFriendsMembers() {
        when(friends.existsAcceptedBetween("alice", "bob")).thenReturn(true);
        service.create("alice", "  Weekend  ", List.of("bob", "alice"));

        verify(members).save(argThat(m -> m.getUsername().equals("alice") && m.isAdmin()));
        verify(members).save(argThat(m -> m.getUsername().equals("bob") && !m.isAdmin()));
        verify(groups).save(argThat(g -> g.getName().equals("Weekend")));
    }

    @Test
    void createEnforcesMemberLimitAndName() {
        List<String> tooMany = new ArrayList<>();
        for (int i = 0; i < GroupService.MAX_MEMBERS; i++) tooMany.add("u" + i);
        assertThatThrownBy(() -> service.create("alice", "Big", tooMany))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> service.create("alice", "   ", List.of()))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    // ── visibility ──────────────────────────────────────────────────

    @Test
    void nonMembersCannotSeeAGroupOrItsEvents() {
        roster(member("alice", GroupMember.Role.ADMIN));
        when(members.findByGroupIdAndUsername("g1", "eve")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get("g1", "eve"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.NOT_FOUND));
        assertThatThrownBy(() -> service.events("g1", "eve"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.NOT_FOUND));
        assertThat(service.isMember("g1", "eve")).isFalse();
    }

    @Test
    void inviteTokenIsOnlyShownToAdmins() {
        group.setInviteToken("secret-token");
        roster(member("alice", GroupMember.Role.ADMIN), member("bob", GroupMember.Role.MEMBER));

        assertThat(service.get("g1", "alice").inviteToken()).isEqualTo("secret-token");
        assertThat(service.get("g1", "bob").inviteToken()).isNull();
        assertThat(service.get("g1", "bob").myRole()).isEqualTo("MEMBER");
    }

    // ── admin-only actions ──────────────────────────────────────────

    @Test
    void membersCannotRenameAddOrManageInvites() {
        roster(member("alice", GroupMember.Role.ADMIN), member("bob", GroupMember.Role.MEMBER));

        assertThatThrownBy(() -> service.update("g1", "bob", "Hijacked", null))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.FORBIDDEN));
        assertThatThrownBy(() -> service.addMembers("g1", "bob", List.of("carol")))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.FORBIDDEN));
        assertThatThrownBy(() -> service.resetInvite("g1", "bob"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.FORBIDDEN));
        assertThatThrownBy(() -> service.setRole("g1", "bob", "bob", "ADMIN"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    void adminCanOnlyAddTheirOwnFriends() {
        roster(member("alice", GroupMember.Role.ADMIN));
        when(friends.existsAcceptedBetween("alice", "carol")).thenReturn(false);

        assertThatThrownBy(() -> service.addMembers("g1", "alice", List.of("carol")))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.BAD_REQUEST));
        verify(members, never()).save(argThat(m -> m.getUsername().equals("carol")));
    }

    @Test
    void avatarMustBeAnUploadedProfileImage() {
        roster(member("alice", GroupMember.Role.ADMIN));
        assertThatThrownBy(() -> service.update("g1", "alice", null, "../../etc/passwd"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.BAD_REQUEST));
        service.update("g1", "alice", null, "prof_0123abcd-0000-4000-8000-123456789abc.png");
        assertThat(group.getAvatarUrl()).isEqualTo("prof_0123abcd-0000-4000-8000-123456789abc.png");
    }

    // ── removal / leaving ───────────────────────────────────────────

    @Test
    void membersMayLeaveButNotRemoveOthers() {
        GroupMember alice = member("alice", GroupMember.Role.ADMIN);
        GroupMember bob = member("bob", GroupMember.Role.MEMBER);
        member("carol", GroupMember.Role.MEMBER);
        roster(alice, bob);

        assertThatThrownBy(() -> service.removeMember("g1", "bob", "carol"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.FORBIDDEN));

        when(members.findByGroupIdOrderByJoinedAtAsc("g1"))
            .thenReturn(List.of(alice, bob))   // before (audience)
            .thenReturn(List.of(alice));       // after leaving
        service.removeMember("g1", "bob", "bob");
        verify(members).delete(bob);
        verify(events).save(argThat(e -> e.getType() == GroupEvent.Type.LEFT));
    }

    @Test
    void lastAdminLeavingPromotesTheLongestStandingMember() {
        GroupMember alice = member("alice", GroupMember.Role.ADMIN);
        GroupMember bob = member("bob", GroupMember.Role.MEMBER);
        when(members.findByGroupIdOrderByJoinedAtAsc("g1"))
            .thenReturn(List.of(alice, bob))
            .thenReturn(List.of(bob));

        service.removeMember("g1", "alice", "alice");
        assertThat(bob.isAdmin()).isTrue();
        verify(events).save(argThat(e -> e.getType() == GroupEvent.Type.PROMOTED && "bob".equals(e.getTarget())));
    }

    @Test
    void lastMemberLeavingDeletesTheGroup() {
        GroupMember alice = member("alice", GroupMember.Role.ADMIN);
        when(members.findByGroupIdOrderByJoinedAtAsc("g1"))
            .thenReturn(List.of(alice))
            .thenReturn(List.of());

        assertThat(service.removeMember("g1", "alice", "alice").group()).isNull();
        verify(groups).delete(group);
    }

    @Test
    void cannotDemoteTheOnlyAdmin() {
        GroupMember alice = member("alice", GroupMember.Role.ADMIN);
        roster(alice, member("bob", GroupMember.Role.MEMBER));
        assertThatThrownBy(() -> service.setRole("g1", "alice", "alice", "MEMBER"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.CONFLICT));
    }

    // ── invite links ────────────────────────────────────────────────

    @Test
    void inviteLinkJoinsAsMemberAndResetInvalidatesOld() {
        GroupMember alice = member("alice", GroupMember.Role.ADMIN);
        roster(alice);
        service.resetInvite("g1", "alice");
        String token = group.getInviteToken();
        assertThat(token).isNotBlank().hasSizeGreaterThanOrEqualTo(32);

        when(groups.findByInviteToken(token)).thenReturn(Optional.of(group));
        service.joinViaInvite(token, "dave");
        verify(members).save(argThat(m -> m.getUsername().equals("dave") && !m.isAdmin()));

        service.resetInvite("g1", "alice");
        assertThat(group.getInviteToken()).isNotEqualTo(token);
        when(groups.findByInviteToken(eq(token))).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.joinViaInvite(token, "erin"))
            .satisfies(t -> assertThat(status(t)).isEqualTo(HttpStatus.NOT_FOUND));
    }
}

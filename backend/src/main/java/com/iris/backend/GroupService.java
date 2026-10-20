package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Group membership and metadata. Every rule about who may do what lives here, so
 * the REST controller and the WebSocket handler enforce the same thing:
 *  - only members see a group, its members, its events, and can message it;
 *  - only admins rename, change the avatar, add/remove others, change roles and
 *    manage the invite link;
 *  - people can only be added by an admin they're friends with, or join through
 *    the group's invite link (so nobody gets pulled into a stranger's group).
 */
@Service
public class GroupService {

    static final int MAX_MEMBERS = 64;          // each message is fanned out per member device
    static final int MAX_NAME = 64;
    private static final String AVATAR_PATTERN = "prof_[0-9a-f-]{36}\\.(jpg|png|webp|gif)";

    private final GroupChatRepository groups;
    private final GroupMemberRepository members;
    private final GroupEventRepository events;
    private final FriendRequestRepository friends;
    private final UserRepository users;
    private final SecureRandom random = new SecureRandom();

    public GroupService(GroupChatRepository groups, GroupMemberRepository members, GroupEventRepository events,
                        FriendRequestRepository friends, UserRepository users) {
        this.groups = groups;
        this.members = members;
        this.events = events;
        this.friends = friends;
        this.users = users;
    }

    // ── DTOs ──────────────────────────────────────────────────────────

    public record MemberDto(String username, String preferredName, String avatarUrl, String role,
                            Instant joinedAt, Instant lastReadAt) { }

    public record GroupDto(String id, String name, String avatarUrl, String createdBy, Instant createdAt,
                           String myRole, List<MemberDto> members, String inviteToken) { }

    public record EventDto(long id, String actor, String type, String target, String detail, Instant at) { }

    public record InvitePreview(String groupId, String name, String avatarUrl, int memberCount, boolean alreadyMember) { }

    /** Who to nudge after a change: every member before and after it. */
    public record Change(GroupDto group, Set<String> audience) { }

    // ── queries used by the socket / key directory ────────────────────

    public boolean isMember(String groupId, String username) {
        return groupId != null && members.existsByGroupIdAndUsername(groupId, username);
    }

    public List<String> memberNames(String groupId) {
        return members.findByGroupIdOrderByJoinedAtAsc(groupId).stream().map(GroupMember::getUsername).toList();
    }

    /** Co-members may fetch each other's identity/devices/bundles to build sessions. */
    public boolean shareAGroup(String a, String b) {
        return a != null && b != null && !a.equals(b) && members.shareAGroup(a, b);
    }

    @Transactional
    public Instant markRead(String groupId, String username) {
        GroupMember m = members.findByGroupIdAndUsername(groupId, username).orElse(null);
        if (m == null) return null;
        Instant now = Instant.now();
        m.setLastReadAt(now);
        members.save(m);
        return now;
    }

    // ── reads ─────────────────────────────────────────────────────────

    public List<GroupDto> listFor(String me) {
        List<GroupDto> out = new ArrayList<>();
        for (GroupMember mine : members.findByUsername(me)) {
            groups.findById(mine.getGroupId()).ifPresent(g -> out.add(toDto(g, me)));
        }
        return out;
    }

    public GroupDto get(String groupId, String me) {
        GroupChat g = requireGroup(groupId);
        requireMember(groupId, me);
        return toDto(g, me);
    }

    public List<EventDto> events(String groupId, String me) {
        requireMember(groupId, me);
        List<GroupEvent> latest = new ArrayList<>(events.findTop500ByGroupIdOrderByIdDesc(groupId));
        java.util.Collections.reverse(latest);
        return latest.stream()
            .map(e -> new EventDto(e.getId(), e.getActor(), e.getType().name(), e.getTarget(), e.getDetail(), e.getCreatedAt()))
            .toList();
    }

    // ── mutations ─────────────────────────────────────────────────────

    @Transactional
    public Change create(String creator, String name, Collection<String> initialMembers) {
        String cleanName = cleanName(name);
        Set<String> invitees = new LinkedHashSet<>(initialMembers == null ? List.of() : initialMembers);
        invitees.remove(creator);
        if (invitees.size() + 1 > MAX_MEMBERS) throw bad("A group can have at most " + MAX_MEMBERS + " members");
        for (String u : invitees) requireFriend(creator, u);

        GroupChat g = groups.save(new GroupChat(UUID.randomUUID().toString(), cleanName, creator));
        members.save(new GroupMember(g.getId(), creator, GroupMember.Role.ADMIN));
        events.save(new GroupEvent(g.getId(), creator, GroupEvent.Type.CREATED, null, cleanName));
        for (String u : invitees) {
            members.save(new GroupMember(g.getId(), u, GroupMember.Role.MEMBER));
            events.save(new GroupEvent(g.getId(), creator, GroupEvent.Type.ADDED, u, null));
        }
        return change(g, creator, Set.of());
    }

    @Transactional
    public Change update(String groupId, String me, String name, String avatarUrl) {
        GroupChat g = requireGroup(groupId);
        requireAdmin(groupId, me);
        Set<String> before = Set.copyOf(memberNames(groupId));
        if (name != null) {
            String clean = cleanName(name);
            if (!clean.equals(g.getName())) {
                g.setName(clean);
                events.save(new GroupEvent(groupId, me, GroupEvent.Type.RENAMED, null, clean));
            }
        }
        if (avatarUrl != null) {
            String clean = avatarUrl.isBlank() ? null : avatarUrl.trim();
            if (clean != null && !clean.matches(AVATAR_PATTERN)) throw bad("Invalid avatar");
            if (!Objects.equals(clean, g.getAvatarUrl())) {
                g.setAvatarUrl(clean);
                events.save(new GroupEvent(groupId, me, GroupEvent.Type.AVATAR, null, null));
            }
        }
        groups.save(g);
        return change(g, me, before);
    }

    @Transactional
    public Change addMembers(String groupId, String me, Collection<String> usernames) {
        GroupChat g = requireGroup(groupId);
        requireAdmin(groupId, me);
        Set<String> before = Set.copyOf(memberNames(groupId));
        Set<String> toAdd = new LinkedHashSet<>(usernames == null ? List.of() : usernames);
        toAdd.removeAll(before);
        if (before.size() + toAdd.size() > MAX_MEMBERS) throw bad("A group can have at most " + MAX_MEMBERS + " members");
        for (String u : toAdd) requireFriend(me, u);
        for (String u : toAdd) {
            members.save(new GroupMember(groupId, u, GroupMember.Role.MEMBER));
            events.save(new GroupEvent(groupId, me, GroupEvent.Type.ADDED, u, null));
        }
        return change(g, me, before);
    }

    /** An admin removing someone, or anyone (target == me) leaving. */
    @Transactional
    public Change removeMember(String groupId, String me, String target) {
        GroupChat g = requireGroup(groupId);
        GroupMember actor = requireMember(groupId, me);
        boolean leaving = me.equals(target);
        if (!leaving && !actor.isAdmin()) throw forbidden();
        GroupMember victim = members.findByGroupIdAndUsername(groupId, target)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Not a member"));

        Set<String> before = Set.copyOf(memberNames(groupId));
        members.delete(victim);
        members.flush();
        events.save(new GroupEvent(groupId, me, leaving ? GroupEvent.Type.LEFT : GroupEvent.Type.REMOVED,
            leaving ? null : target, null));

        List<GroupMember> remaining = members.findByGroupIdOrderByJoinedAtAsc(groupId);
        if (remaining.isEmpty()) {
            // Last one out: the group (and its metadata trail) goes away.
            events.deleteByGroupId(groupId);
            groups.delete(g);
            return new Change(null, before);
        }
        if (remaining.stream().noneMatch(GroupMember::isAdmin)) {
            // Never leave a group without an admin: promote the longest-standing member.
            GroupMember heir = remaining.get(0);
            heir.setRole(GroupMember.Role.ADMIN);
            members.save(heir);
            events.save(new GroupEvent(groupId, me, GroupEvent.Type.PROMOTED, heir.getUsername(), null));
        }
        return change(g, me, before);
    }

    @Transactional
    public Change setRole(String groupId, String me, String target, String role) {
        GroupChat g = requireGroup(groupId);
        requireAdmin(groupId, me);
        GroupMember.Role next;
        try {
            next = GroupMember.Role.valueOf(role == null ? "" : role.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw bad("role must be ADMIN or MEMBER");
        }
        GroupMember m = members.findByGroupIdAndUsername(groupId, target)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Not a member"));
        if (m.getRole() == next) return change(g, me, Set.of());
        if (next == GroupMember.Role.MEMBER) {
            long admins = members.findByGroupIdOrderByJoinedAtAsc(groupId).stream().filter(GroupMember::isAdmin).count();
            if (admins <= 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "A group needs at least one admin");
        }
        m.setRole(next);
        members.save(m);
        events.save(new GroupEvent(groupId, me,
            next == GroupMember.Role.ADMIN ? GroupEvent.Type.PROMOTED : GroupEvent.Type.DEMOTED, target, null));
        return change(g, me, Set.of());
    }

    /** New random invite token; the previous link stops working immediately. */
    @Transactional
    public Change resetInvite(String groupId, String me) {
        GroupChat g = requireGroup(groupId);
        requireAdmin(groupId, me);
        byte[] raw = new byte[24];
        random.nextBytes(raw);
        g.setInviteToken(Base64.getUrlEncoder().withoutPadding().encodeToString(raw));
        groups.save(g);
        return change(g, me, Set.of());
    }

    @Transactional
    public Change disableInvite(String groupId, String me) {
        GroupChat g = requireGroup(groupId);
        requireAdmin(groupId, me);
        g.setInviteToken(null);
        groups.save(g);
        return change(g, me, Set.of());
    }

    public InvitePreview previewInvite(String token, String me) {
        GroupChat g = byInvite(token);
        return new InvitePreview(g.getId(), g.getName(), g.getAvatarUrl(),
            (int) members.countByGroupId(g.getId()), isMember(g.getId(), me));
    }

    @Transactional
    public Change joinViaInvite(String token, String me) {
        GroupChat g = byInvite(token);
        Set<String> before = Set.copyOf(memberNames(g.getId()));
        if (before.contains(me)) return change(g, me, before);
        if (before.size() + 1 > MAX_MEMBERS) throw new ResponseStatusException(HttpStatus.CONFLICT, "This group is full");
        members.save(new GroupMember(g.getId(), me, GroupMember.Role.MEMBER));
        events.save(new GroupEvent(g.getId(), me, GroupEvent.Type.JOINED, null, null));
        return change(g, me, before);
    }

    // ── helpers ───────────────────────────────────────────────────────

    private GroupChat byInvite(String token) {
        if (token == null || token.isBlank()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Invite not found");
        return groups.findByInviteToken(token)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "This invite link is no longer valid"));
    }

    private Change change(GroupChat g, String me, Set<String> before) {
        Set<String> audience = new LinkedHashSet<>(before);
        audience.addAll(memberNames(g.getId()));
        return new Change(toDto(g, me), audience);
    }

    private GroupDto toDto(GroupChat g, String me) {
        List<GroupMember> list = members.findByGroupIdOrderByJoinedAtAsc(g.getId());
        // At most MAX_MEMBERS lookups by a unique, indexed column.
        Map<String, User> profiles = list.stream()
            .map(m -> users.findByUsername(m.getUsername()).orElse(null))
            .filter(Objects::nonNull)
            .collect(Collectors.toMap(User::getUsername, Function.identity(), (a, b) -> a));
        String myRole = null;
        List<MemberDto> dtos = new ArrayList<>();
        for (GroupMember m : list) {
            if (m.getUsername().equals(me)) myRole = m.getRole().name();
            User u = profiles.get(m.getUsername());
            dtos.add(new MemberDto(m.getUsername(), u == null ? null : u.getPreferredName(),
                u == null ? null : u.getAvatarUrl(), m.getRole().name(), m.getJoinedAt(), m.getLastReadAt()));
        }
        // The invite token is a bearer secret: only admins get to see (and share) it.
        String invite = "ADMIN".equals(myRole) ? g.getInviteToken() : null;
        return new GroupDto(g.getId(), g.getName(), g.getAvatarUrl(), g.getCreatedBy(), g.getCreatedAt(),
            myRole, dtos, invite);
    }

    private GroupChat requireGroup(String groupId) {
        return groups.findById(groupId == null ? "" : groupId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Group not found"));
    }

    // Non-members get the same 404 as a missing group: no probing which ids exist.
    private GroupMember requireMember(String groupId, String me) {
        return members.findByGroupIdAndUsername(groupId, me)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Group not found"));
    }

    private GroupMember requireAdmin(String groupId, String me) {
        GroupMember m = requireMember(groupId, me);
        if (!m.isAdmin()) throw forbidden();
        return m;
    }

    private void requireFriend(String me, String other) {
        if (other == null || other.isBlank() || users.findByUsername(other).isEmpty()) throw bad("Unknown user: " + other);
        if (!friends.existsAcceptedBetween(me, other)) throw bad("You can only add people you're connected with: " + other);
    }

    private static String cleanName(String name) {
        String clean = name == null ? "" : name.trim();
        if (clean.isEmpty()) throw bad("Group name is required");
        if (clean.length() > MAX_NAME) throw bad("Group name is too long");
        return clean;
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }

    private static ResponseStatusException forbidden() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, "Only group admins can do that");
    }
}

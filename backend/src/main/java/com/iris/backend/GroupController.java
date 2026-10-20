package com.iris.backend;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Group management. Rules live in GroupService; this layer only maps requests and
 * nudges every affected member's open sockets ("groups-changed") so lists, member
 * panels and system lines refresh live.
 */
@RestController
@RequestMapping("/api/groups")
public class GroupController {

    private final GroupService groups;
    private final ChatWebSocketHandler chatHandler;

    public GroupController(GroupService groups, ChatWebSocketHandler chatHandler) {
        this.groups = groups;
        this.chatHandler = chatHandler;
    }

    public record CreateRequest(String name, List<String> members) { }
    public record UpdateRequest(String name, String avatarUrl) { }
    public record MembersRequest(List<String> usernames) { }
    public record RoleRequest(String role) { }

    private GroupService.GroupDto announce(GroupService.Change change) {
        for (String u : change.audience()) chatHandler.notifyUser(u, "groups-changed");
        return change.group();
    }

    @GetMapping
    public List<GroupService.GroupDto> mine(Authentication auth) {
        return groups.listFor(auth.getName());
    }

    @PostMapping
    public GroupService.GroupDto create(@RequestBody CreateRequest req, Authentication auth) {
        return announce(groups.create(auth.getName(), req.name(), req.members()));
    }

    @GetMapping("/{id}")
    public GroupService.GroupDto get(@PathVariable String id, Authentication auth) {
        return groups.get(id, auth.getName());
    }

    @PutMapping("/{id}")
    public GroupService.GroupDto update(@PathVariable String id, @RequestBody UpdateRequest req, Authentication auth) {
        return announce(groups.update(id, auth.getName(), req.name(), req.avatarUrl()));
    }

    @GetMapping("/{id}/events")
    public List<GroupService.EventDto> events(@PathVariable String id, Authentication auth) {
        return groups.events(id, auth.getName());
    }

    @PostMapping("/{id}/members")
    public GroupService.GroupDto addMembers(@PathVariable String id, @RequestBody MembersRequest req, Authentication auth) {
        return announce(groups.addMembers(id, auth.getName(), req.usernames()));
    }

    /** Remove a member (admin) or leave (your own username). */
    @DeleteMapping("/{id}/members/{username}")
    public ResponseEntity<GroupService.GroupDto> removeMember(@PathVariable String id, @PathVariable String username,
                                                              Authentication auth) {
        GroupService.GroupDto after = announce(groups.removeMember(id, auth.getName(), username));
        // The caller left (or emptied the group): there's no group view to return to them.
        return after == null || username.equals(auth.getName())
            ? ResponseEntity.noContent().build()
            : ResponseEntity.ok(after);
    }

    @PutMapping("/{id}/members/{username}/role")
    public GroupService.GroupDto setRole(@PathVariable String id, @PathVariable String username,
                                         @RequestBody RoleRequest req, Authentication auth) {
        return announce(groups.setRole(id, auth.getName(), username, req.role()));
    }

    @PostMapping("/{id}/invite")
    public GroupService.GroupDto resetInvite(@PathVariable String id, Authentication auth) {
        return announce(groups.resetInvite(id, auth.getName()));
    }

    @DeleteMapping("/{id}/invite")
    public GroupService.GroupDto disableInvite(@PathVariable String id, Authentication auth) {
        return announce(groups.disableInvite(id, auth.getName()));
    }

    @GetMapping("/invite/{token}")
    public GroupService.InvitePreview previewInvite(@PathVariable String token, Authentication auth) {
        return groups.previewInvite(token, auth.getName());
    }

    @PostMapping("/invite/{token}/join")
    public GroupService.GroupDto join(@PathVariable String token, Authentication auth) {
        return announce(groups.joinViaInvite(token, auth.getName()));
    }
}

package com.iris.backend;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api")
public class PrivacyController {

    private final UserRepository users;
    private final PrivacyService privacy;
    private final InviteRateLimiter limiter;
    private final ChatWebSocketHandler chatHandler;

    public PrivacyController(UserRepository users, PrivacyService privacy,
                             InviteRateLimiter limiter, ChatWebSocketHandler chatHandler) {
        this.users = users;
        this.privacy = privacy;
        this.limiter = limiter;
        this.chatHandler = chatHandler;
    }

    public record PrivacySettings(boolean privateProfile, boolean invitesEnabled, String inviteCode) {}
    public record PrivacyUpdate(Boolean privateProfile, Boolean invitesEnabled) {}
    public record BlockedUser(String username) {}

    private User me(Authentication auth) {
        return users.findByUsername(auth.getName()).orElseThrow();
    }

    private PrivacySettings settingsOf(User u) {
        String code = u.isInvitesEnabled() ? InviteCodes.format(privacy.ensureInviteCode(u)) : null;
        return new PrivacySettings(u.isPrivateProfile(), u.isInvitesEnabled(), code);
    }

    @GetMapping("/privacy")
    public PrivacySettings get(Authentication auth) {
        return settingsOf(me(auth));
    }

    @PutMapping("/privacy")
    public PrivacySettings update(@RequestBody PrivacyUpdate body, Authentication auth) {
        User u = me(auth);
        if (body.privateProfile() != null) u.setPrivateProfile(body.privateProfile());
        if (body.invitesEnabled() != null) u.setInvitesEnabled(body.invitesEnabled());
        users.save(u);
        return settingsOf(u);
    }

    @PostMapping("/privacy/invite/reset")
    public PrivacySettings resetInvite(Authentication auth) {
        User u = me(auth);
        privacy.rotateInviteCode(u);
        return settingsOf(u);
    }

    /** Preview who an invite belongs to before sending a request. Rate-limited. */
    @GetMapping("/users/by-invite/{code}")
    public UserProfileDto byInvite(@PathVariable String code, Authentication auth, HttpServletRequest request) {
        if (!limiter.tryAcquire(auth.getName(), request)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts, try again later");
        }
        String me = auth.getName();
        User target = privacy.byInviteCode(code)
                .filter(u -> !privacy.isBlockedEitherWay(me, u.getUsername()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Invite not found"));
        // The owner handed this code out, so the holder may see who it is — but the
        // share id stays hidden; requests go through the code itself.
        return new UserProfileDto(target.getUsername(), target.getPreferredName(), target.getAvatarUrl(), null);
    }

    @GetMapping("/blocks")
    public List<BlockedUser> blocked(Authentication auth) {
        return privacy.blockedBy(auth.getName()).stream().map(BlockedUser::new).toList();
    }

    @PostMapping("/blocks/{username}")
    public ResponseEntity<Void> block(@PathVariable String username, Authentication auth) {
        String me = auth.getName();
        if (username.equals(me)) return ResponseEntity.badRequest().build();
        if (users.findByUsername(username).isEmpty()) return ResponseEntity.notFound().build();
        privacy.block(me, username);
        chatHandler.notifyUser(me, "friends-changed");
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/blocks/{username}")
    public ResponseEntity<Void> unblock(@PathVariable String username, Authentication auth) {
        String me = auth.getName();
        if (!privacy.unblock(me, username)) return ResponseEntity.notFound().build();
        chatHandler.notifyUser(me, "friends-changed");
        return ResponseEntity.noContent().build();
    }
}

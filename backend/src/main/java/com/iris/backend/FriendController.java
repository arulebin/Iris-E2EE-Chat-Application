package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import jakarta.servlet.http.HttpServletRequest;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@RestController
@RequestMapping("/api/friends")
public class FriendController {

    private final FriendRequestRepository friendRepository;
    private final UserRepository userRepository;
    private final PushNotificationService pushService;
    private final ChatWebSocketHandler chatHandler;
    private final PrivacyService privacy;
    private final InviteRateLimiter limiter;

    public FriendController(FriendRequestRepository friendRepository,
                            UserRepository userRepository,
                            PushNotificationService pushService,
                            ChatWebSocketHandler chatHandler,
                            PrivacyService privacy,
                            InviteRateLimiter limiter) {
        this.friendRepository = friendRepository;
        this.userRepository   = userRepository;
        this.pushService      = pushService;
        this.chatHandler      = chatHandler;
        this.privacy          = privacy;
        this.limiter          = limiter;
    }

    // Push text stays generic (no usernames leave via FCM/Web Push); open clients
    // get a WebSocket nudge so request lists and friend lists refresh live.
    private void notifyRequest(String to) {
        pushService.sendSocial(to, FcmSender.SocialEvent.REQUEST);
        chatHandler.notifyUser(to, "friends-changed");
    }

    private void notifyAccepted(String requester, String accepter) {
        pushService.sendSocial(requester, FcmSender.SocialEvent.ACCEPTED);
        chatHandler.notifyUser(requester, "friends-changed");
        chatHandler.notifyUser(accepter, "friends-changed"); // the accepter's other tabs/devices
    }

    public record FriendRequestDto(Long id, String fromUser, String toUser, String status, Instant createdAt) {}
    // Exactly one target: toInviteCode (works for private profiles) or toShareId
    // (search results; discoverable profiles only).
    public record SendRequestBody(String toShareId, String toInviteCode) {}

    private FriendRequestDto toDto(FriendRequest fr) {
        return new FriendRequestDto(fr.getId(), fr.getFromUser(), fr.getToUser(),
                                    fr.getStatus().name(), fr.getCreatedAt());
    }

    @PostMapping("/request")
    public ResponseEntity<?> sendRequest(@RequestBody SendRequestBody body, Authentication auth,
                                         HttpServletRequest http) {
        String me = auth.getName();
        java.util.Optional<User> found;
        if (body.toInviteCode() != null) {
            if (!limiter.tryAcquire(me, http)) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts, try again later");
            }
            found = privacy.byInviteCode(body.toInviteCode());
        } else if (body.toShareId() != null) {
            found = privacy.byShareId(body.toShareId());
        } else {
            found = java.util.Optional.empty();
        }
        User target = found
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        String them = target.getUsername();

        if (them.equals(me)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Cannot send request to yourself"));
        }
        if (privacy.haveBlocked(me, them)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Unblock this person first"));
        }
        // They blocked me: answer exactly like a sent request so the block isn't revealed.
        if (privacy.haveBlocked(them, me)) {
            return ResponseEntity.ok(Map.of("message", "Request sent"));
        }

        // Look at any existing relationship in both directions. The unique
        // constraint is on (from_user, to_user), so we reuse rows instead of
        // inserting duplicates (which previously threw a 500).
        var outgoing = friendRepository.findByFromUserAndToUser(me, them);
        var incoming = friendRepository.findByFromUserAndToUser(them, me);

        boolean connected =
                outgoing.map(r -> r.getStatus() == FriendRequest.Status.ACCEPTED).orElse(false) ||
                incoming.map(r -> r.getStatus() == FriendRequest.Status.ACCEPTED).orElse(false);
        if (connected) {
            return ResponseEntity.ok(Map.of("message", "Already connected"));
        }

        // They already requested me → connecting back just accepts it (mutual).
        if (incoming.isPresent() && incoming.get().getStatus() == FriendRequest.Status.PENDING) {
            FriendRequest req = incoming.get();
            req.setStatus(FriendRequest.Status.ACCEPTED);
            friendRepository.save(req);
            notifyAccepted(them, me);
            return ResponseEntity.ok(toDto(req));
        }

        // I already have a row to them → reuse it: re-arm a rejected one, or
        // report the still-pending one.
        if (outgoing.isPresent()) {
            FriendRequest req = outgoing.get();
            if (req.getStatus() == FriendRequest.Status.PENDING) {
                return ResponseEntity.ok(Map.of("message", "Request already sent"));
            }
            req.setStatus(FriendRequest.Status.PENDING); // was REJECTED
            friendRepository.save(req);
            notifyRequest(them);
            return ResponseEntity.ok(toDto(req));
        }

        // Fresh request.
        FriendRequest req = friendRepository.save(new FriendRequest(me, them));
        notifyRequest(them);
        return ResponseEntity.ok(toDto(req));
    }

    @GetMapping("/requests/incoming")
    public List<FriendRequestDto> incomingRequests(Authentication auth) {
        String me = auth.getName();
        return friendRepository.findByToUserAndStatus(me, FriendRequest.Status.PENDING)
                .stream()
                .filter(fr -> !privacy.isBlockedEitherWay(me, fr.getFromUser()))
                .map(this::toDto).toList();
    }

    @PutMapping("/requests/{id}/accept")
    public FriendRequestDto accept(@PathVariable Long id, Authentication auth) {
        FriendRequest req = friendRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!req.getToUser().equals(auth.getName())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        req.setStatus(FriendRequest.Status.ACCEPTED);
        FriendRequest saved = friendRepository.save(req);
        notifyAccepted(req.getFromUser(), auth.getName());
        return toDto(saved);
    }

    @PutMapping("/requests/{id}/reject")
    public FriendRequestDto reject(@PathVariable Long id, Authentication auth) {
        FriendRequest req = friendRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!req.getToUser().equals(auth.getName())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        }
        req.setStatus(FriendRequest.Status.REJECTED);
        return toDto(friendRepository.save(req));
    }

    @GetMapping
    public List<UserProfileDto> getFriends(Authentication auth) {
        String me = auth.getName();
        return friendRepository.findAcceptedByUser(me).stream()
                .map(fr -> fr.getFromUser().equals(me) ? fr.getToUser() : fr.getFromUser())
                .filter(username -> !privacy.haveBlocked(me, username))
                .map(username -> userRepository.findByUsername(username).map(u -> privacy.profileFor(me, u)).orElse(null))
                .filter(Objects::nonNull)
                .toList();
    }
}

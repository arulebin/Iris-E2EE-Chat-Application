package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

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

    public FriendController(FriendRequestRepository friendRepository,
                            UserRepository userRepository,
                            PushNotificationService pushService) {
        this.friendRepository = friendRepository;
        this.userRepository   = userRepository;
        this.pushService      = pushService;
    }

    public record FriendRequestDto(Long id, String fromUser, String toUser, String status, Instant createdAt) {}
    public record SendRequestBody(String toShareId) {}

    private FriendRequestDto toDto(FriendRequest fr) {
        return new FriendRequestDto(fr.getId(), fr.getFromUser(), fr.getToUser(),
                                    fr.getStatus().name(), fr.getCreatedAt());
    }

    @PostMapping("/request")
    public ResponseEntity<?> sendRequest(@RequestBody SendRequestBody body, Authentication auth) {
        String me = auth.getName();
        User target = userRepository.findByShareId(body.toShareId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
        String them = target.getUsername();

        if (them.equals(me)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Cannot send request to yourself"));
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
            pushService.sendToUser(them, "Iris", me + " accepted your connection request");
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
            pushService.sendToUser(them, "Iris", me + " wants to connect with you");
            return ResponseEntity.ok(toDto(req));
        }

        // Fresh request.
        FriendRequest req = friendRepository.save(new FriendRequest(me, them));
        pushService.sendToUser(them, "Iris", me + " wants to connect with you");
        return ResponseEntity.ok(toDto(req));
    }

    @GetMapping("/requests/incoming")
    public List<FriendRequestDto> incomingRequests(Authentication auth) {
        return friendRepository.findByToUserAndStatus(auth.getName(), FriendRequest.Status.PENDING)
                .stream().map(this::toDto).toList();
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
        pushService.sendToUser(req.getFromUser(), "Iris", auth.getName() + " accepted your connection request");
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
                .map(username -> userRepository.findByUsername(username).map(UserProfileDto::from).orElse(null))
                .filter(Objects::nonNull)
                .toList();
    }
}

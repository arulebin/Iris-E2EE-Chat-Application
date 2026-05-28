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

        if (target.getUsername().equals(me)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Cannot send request to yourself"));
        }

        if (friendRepository.existsByFromUserAndToUserAndStatus(me, target.getUsername(), FriendRequest.Status.PENDING)) {
            return ResponseEntity.ok(Map.of("message", "Request already sent"));
        }

        FriendRequest req = friendRepository.save(new FriendRequest(me, target.getUsername()));
        pushService.sendToUser(target.getUsername(), "Iris", me + " wants to connect with you");
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

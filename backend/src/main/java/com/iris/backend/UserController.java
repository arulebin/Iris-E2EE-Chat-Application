package com.iris.backend;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class UserController {
    
    private final UserRepository userRepository;
    private final FriendRequestRepository friendRepository;
    private final ChatWebSocketHandler chatHandler;
    private final PrivacyService privacy;

    public UserController(UserRepository userRepository, FriendRequestRepository friendRepository,
                          ChatWebSocketHandler chatHandler, PrivacyService privacy) {
        this.userRepository = userRepository;
        this.friendRepository = friendRepository;
        this.chatHandler = chatHandler;
        this.privacy = privacy;
    }

    @GetMapping("/users")
    public List<UserProfileDto> getUsers(Authentication auth) {
        String me = auth.getName();

        // Contacts = people I've exchanged messages with, unioned with everyone
        // I'm connected to (accepted requests) — so a brand-new friend with no
        // messages yet still shows up in the list. Insertion order preserved.
        Map<String, User> contacts = new LinkedHashMap<>();
        for (User u : userRepository.findUsersWithHistory(me)) {
            contacts.put(u.getUsername(), u);
        }
        for (FriendRequest fr : friendRepository.findAcceptedByUser(me)) {
            String other = fr.getFromUser().equals(me) ? fr.getToUser() : fr.getFromUser();
            contacts.computeIfAbsent(other, name -> userRepository.findByUsername(name).orElse(null));
        }
        contacts.remove(me);
        privacy.blockedBy(me).forEach(contacts::remove);   // blocked people leave my list

        return contacts.values().stream()
                .filter(Objects::nonNull)
                .map(u -> privacy.profileFor(me, u))
                .toList();
    }

    @GetMapping("/users/{username}")
    public UserProfileDto getUser(@PathVariable String username, Authentication auth) {
        String me = auth.getName();
        return privacy.visibleByUsername(me, username)
                .map(u -> privacy.profileFor(me, u))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }

    @GetMapping("/users/by-share/{shareId}")
    public UserProfileDto getUserByShareId(@PathVariable String shareId, Authentication auth) {
        String me = auth.getName();
        return privacy.byShareId(shareId)
                .filter(u -> !privacy.isBlockedEitherWay(me, u.getUsername()))
                .map(u -> privacy.profileFor(me, u))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }

    @GetMapping("/users/search")
    public List<UserProfileDto> searchUsers(@RequestParam String q, Authentication auth) {
        if (q == null || q.isBlank()) return List.of();
        String me = auth.getName();
        return privacy.search(me, q.trim()).stream()
                .map(UserProfileDto::from)
                .toList();
    }

    public record ProfileUpdateRequest(String preferredName, String avatarUrl) {}

    @PutMapping("/users/profile")
    public UserProfileDto updateProfile(@RequestBody ProfileUpdateRequest request, Authentication auth) {
        User user = userRepository.findByUsername(auth.getName()).orElseThrow();
        if (request.preferredName() != null) user.setPreferredName(request.preferredName());
        if (request.avatarUrl() != null) user.setAvatarUrl(request.avatarUrl());
        userRepository.save(user);
        // Friends' open clients refresh their contact list (name/avatar) live.
        String me = user.getUsername();
        for (FriendRequest fr : friendRepository.findAcceptedByUser(me)) {
            chatHandler.notifyUser(fr.getFromUser().equals(me) ? fr.getToUser() : fr.getFromUser(), "friends-changed");
        }
        return UserProfileDto.from(user);
    }
}

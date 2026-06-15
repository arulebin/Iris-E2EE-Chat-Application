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

    public UserController(UserRepository userRepository, FriendRequestRepository friendRepository) {
        this.userRepository = userRepository;
        this.friendRepository = friendRepository;
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

        return contacts.values().stream()
                .filter(Objects::nonNull)
                .map(UserProfileDto::from)
                .toList();
    }

    @GetMapping("/users/{username}")
    public UserProfileDto getUser(@PathVariable String username) {
        return userRepository.findByUsername(username)
                .map(UserProfileDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }

    @GetMapping("/users/by-share/{shareId}")
    public UserProfileDto getUserByShareId(@PathVariable String shareId) {
        return userRepository.findByShareId(shareId)
                .map(UserProfileDto::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found"));
    }

    @GetMapping("/users/search")
    public List<UserProfileDto> searchUsers(@RequestParam String q, Authentication auth) {
        if (q == null || q.isBlank()) return List.of();
        String me = auth.getName();
        return userRepository.searchUsers(q.trim()).stream()
                .filter(u -> !u.getUsername().equals(me))
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
        return UserProfileDto.from(user);
    }
}

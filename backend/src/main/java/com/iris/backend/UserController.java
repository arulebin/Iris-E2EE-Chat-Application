package com.iris.backend;

import java.util.List;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class UserController {
    
    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping("/users")
    public List<String> getUsers(Authentication auth) {
        String me = auth.getName();
        return userRepository.findAll().stream()
        .map(User::getUsername)
        .filter(name -> !name.equals(me))
        .toList();
   }
}

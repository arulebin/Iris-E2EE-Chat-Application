package com.iris.backend;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    // Constructor injection — Spring auto-wires both
    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public User signup(String username, String rawPassword) {
        if(username ==null || rawPassword == null || username.isBlank() || rawPassword.isBlank()){
            throw new IllegalArgumentException("Error: Username and Password cannot be null or blank");
        }
        if(userRepository.existsByUsername(username)) throw new IllegalStateException("Error: Username already exists");
        String hashedPassword = passwordEncoder.encode(rawPassword);
        User user= new User(username, hashedPassword);
        userRepository.save(user);
        return user;
    }
}

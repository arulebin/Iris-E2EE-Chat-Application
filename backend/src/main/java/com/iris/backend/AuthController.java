package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final UserService userService;

    public AuthController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody SignupRequest req) {
        try {
            User user = userService.signup(req.username(), req.authKey(), req.authSalt());
            return ResponseEntity.status(HttpStatus.CREATED).body(new SignupResponse(user.getId(), user.getUsername()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest req) {
        try {
            String token = userService.login(req.username(), req.password(), req.authKey());
            return ResponseEntity.status(HttpStatus.OK).body(new LoginResponse(token));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(e.getMessage());
        }
    }

    // Unauthenticated by necessity: the client needs the salt to derive authKey before it can log in.
    @GetMapping("/salt/{username}")
    public UserService.SaltResponse salt(@PathVariable String username) {
        return userService.saltFor(username);
    }
}

package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final UserService userService;
    private final SessionService sessionService;
    private final JwtService jwtService;

    public AuthController(UserService userService, SessionService sessionService, JwtService jwtService) {
        this.userService = userService;
        this.sessionService = sessionService;
        this.jwtService = jwtService;
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
            return ResponseEntity.status(HttpStatus.OK)
                    .body(new LoginResponse(token, sessionService.issue(req.username())));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(e.getMessage());
        }
    }

    // Trades a refresh token for a new access token + rotated refresh token.
    // 401 → the login is over (expired, revoked, or reuse detected); 409 → another
    // tab rotated this token a moment ago, so re-read storage and retry.
    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(@RequestBody RefreshRequest req) {
        try {
            SessionService.Rotated r = sessionService.rotate(req.refreshToken(), req.deviceId());
            return ResponseEntity.ok(new LoginResponse(jwtService.generateToken(r.username()), r.refreshToken()));
        } catch (SessionService.RefreshRaceException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        } catch (SessionService.InvalidRefreshException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(e.getMessage());
        }
    }

    // Possession of the refresh token is the credential, so this needs no access token
    // (it may already have expired when the user logs out).
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@RequestBody RefreshRequest req) {
        sessionService.revoke(req.refreshToken());
        return ResponseEntity.noContent().build();
    }

    public record RefreshRequest(String refreshToken, Integer deviceId) { }

    // Unauthenticated by necessity: the client needs the salt to derive authKey before it can log in.
    @GetMapping("/salt/{username}")
    public UserService.SaltResponse salt(@PathVariable String username) {
        return userService.saltFor(username);
    }
}

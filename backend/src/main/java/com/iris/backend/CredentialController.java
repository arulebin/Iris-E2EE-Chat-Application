package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Lives under /api (JWT-authenticated), not /auth (permitAll).
@RestController
@RequestMapping("/api/credentials")
public class CredentialController {

    private final UserService userService;

    public CredentialController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/upgrade")
    public ResponseEntity<?> upgrade(@RequestBody UserService.UpgradeRequest req, Authentication auth) {
        try {
            userService.upgradeCredentials(auth.getName(), req);
            return ResponseEntity.ok().build();
        } catch (SecurityException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}

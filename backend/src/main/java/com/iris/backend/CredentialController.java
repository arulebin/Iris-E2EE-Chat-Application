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
    private final SessionService sessionService;
    private final JwtService jwtService;

    public CredentialController(UserService userService, SessionService sessionService, JwtService jwtService) {
        this.userService = userService;
        this.sessionService = sessionService;
        this.jwtService = jwtService;
    }

    // A credential change ends every existing login of the account. The calling
    // device gets a fresh {token, refreshToken} so its own upgrade doesn't log it out.
    @PostMapping("/upgrade")
    public ResponseEntity<?> upgrade(@RequestBody UserService.UpgradeRequest req, Authentication auth) {
        try {
            userService.upgradeCredentials(auth.getName(), req);
            String refreshToken = sessionService.revokeAllAndReissue(auth.getName());
            return ResponseEntity.ok(new LoginResponse(jwtService.generateToken(auth.getName()), refreshToken));
        } catch (SecurityException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}

package com.iris.backend;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Signal-protocol key directory. Everything a stranger could use to drain prekeys
 * or enumerate devices is limited to the account itself, its accepted friends, and
 * the people it shares a group with.
 */
@RestController
@RequestMapping("/api/signal")
public class SignalController {

    private final SignalKeyService keys;
    private final UserRepository userRepository;
    private final FriendRequestRepository friendRequestRepository;
    private final DeviceCleanupService cleanup;
    private final GroupService groups;

    public SignalController(SignalKeyService keys, UserRepository userRepository,
                            FriendRequestRepository friendRequestRepository, DeviceCleanupService cleanup,
                            GroupService groups) {
        this.keys = keys;
        this.userRepository = userRepository;
        this.friendRequestRepository = friendRequestRepository;
        this.cleanup = cleanup;
        this.groups = groups;
    }

    // Friends, plus anyone you share a group with: group messages are fanned out to
    // every member's devices, so members need sessions even if they aren't friends.
    private boolean canSee(String me, String other) {
        return me.equals(other) || friendRequestRepository.existsAcceptedBetween(me, other)
            || groups.shareAGroup(me, other);
    }

    private static ResponseEntity<Object> bad(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    // ── identity ──────────────────────────────────────────────────────

    public record MyIdentity(String identityKey, String encryptedIdentityKey, String identityKeySalt, String crossSignature) { }
    public record PublicIdentity(String identityKey, String crossSignature) { }

    @GetMapping("/identity/me")
    public MyIdentity myIdentity(Authentication auth) {
        User u = userRepository.findByUsername(auth.getName()).orElseThrow();
        return new MyIdentity(u.getIdentityKey(), u.getEncryptedIdentityKey(), u.getIdentityKeySalt(), u.getIdentityCrossSignature());
    }

    @PostMapping("/identity")
    public ResponseEntity<Object> publishIdentity(@RequestBody SignalKeyService.IdentityPublish req, Authentication auth) {
        try {
            keys.publishIdentity(auth.getName(), req);
            return ResponseEntity.ok().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        } catch (IllegalArgumentException e) {
            return bad(e);
        }
    }

    @GetMapping("/identity/{username}")
    public ResponseEntity<PublicIdentity> identity(@PathVariable String username, Authentication auth) {
        if (!canSee(auth.getName(), username)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        return userRepository.findByUsername(username)
            .filter(u -> u.getIdentityKey() != null)
            .map(u -> ResponseEntity.ok(new PublicIdentity(u.getIdentityKey(), u.getIdentityCrossSignature())))
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    // ── devices ───────────────────────────────────────────────────────

    @PostMapping("/devices")
    public ResponseEntity<Object> registerDevice(@RequestBody SignalKeyService.DeviceRegistration req, Authentication auth) {
        try {
            // Same phone, reinstalled: its previous registrations are dead — retire them first (this also
            // frees their slots under the device limit).
            cleanup.retireSameInstall(auth.getName(), SignalKeyService.validInstallKey(req.installKey()));
            return ResponseEntity.ok(Map.of("deviceId", keys.registerDevice(auth.getName(), req)));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
        } catch (DataIntegrityViolationException e) {
            // Two devices registering at the same instant raced for one id — client retries.
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "retry"));
        } catch (IllegalArgumentException e) {
            return bad(e);
        }
    }

    /** Device list. Friends get ids only; the owner also sees labels and activity. */
    @GetMapping("/devices/{username}")
    public ResponseEntity<Object> devices(@PathVariable String username, Authentication auth) {
        String me = auth.getName();
        if (!canSee(me, username)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        List<SignalKeyService.DeviceInfo> list = keys.listDevices(username);
        if (me.equals(username)) return ResponseEntity.ok(list);
        return ResponseEntity.ok(list.stream()
            .map(d -> Map.of("deviceId", d.deviceId(), "registrationId", d.registrationId()))
            .toList());
    }

    @DeleteMapping("/devices/{deviceId}")
    public ResponseEntity<Void> removeDevice(@PathVariable int deviceId, Authentication auth) {
        if (!cleanup.retire(auth.getName(), deviceId)) return ResponseEntity.notFound().build();
        return ResponseEntity.noContent().build();
    }

    public record InstallKeyClaim(String installKey) { }

    /**
     * An already-registered app device reports its install key (app builds from before the key existed
     * registered without one). Stores it and retires this phone's other, dead installs. Idempotent.
     */
    @PostMapping("/devices/{deviceId}/install-key")
    public ResponseEntity<Object> claimInstallKey(@PathVariable int deviceId, @RequestBody InstallKeyClaim req, Authentication auth) {
        if (req == null || req.installKey() == null) return ResponseEntity.badRequest().body(Map.of("error", "installKey is required"));
        try {
            List<Integer> removed = cleanup.claim(auth.getName(), deviceId, req.installKey());
            if (removed == null) return ResponseEntity.notFound().build();
            return ResponseEntity.ok(Map.of("removed", removed));
        } catch (IllegalArgumentException e) {
            return bad(e);
        }
    }

    public record PreKeyUpload(List<SignalKeyService.PreKeyDto> preKeys) { }

    @PostMapping("/devices/{deviceId}/prekeys")
    public ResponseEntity<Object> uploadPreKeys(@PathVariable int deviceId, @RequestBody PreKeyUpload req, Authentication auth) {
        if (!keys.deviceExists(auth.getName(), deviceId)) return ResponseEntity.notFound().build();
        try {
            keys.storePreKeys(auth.getName(), deviceId, req.preKeys());
            return ResponseEntity.ok(Map.of("count", keys.preKeyCount(auth.getName(), deviceId)));
        } catch (IllegalArgumentException e) {
            return bad(e);
        }
    }

    @GetMapping("/devices/{deviceId}/prekeys/count")
    public ResponseEntity<Object> preKeyCount(@PathVariable int deviceId, Authentication auth) {
        if (!keys.deviceExists(auth.getName(), deviceId)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of("count", keys.preKeyCount(auth.getName(), deviceId)));
    }

    @PutMapping("/devices/{deviceId}/signed-prekey")
    public ResponseEntity<Object> rotateSignedPreKey(@PathVariable int deviceId,
                                                     @RequestBody SignalKeyService.SignedPreKeyDto req, Authentication auth) {
        if (!keys.deviceExists(auth.getName(), deviceId)) return ResponseEntity.notFound().build();
        try {
            keys.rotateSignedPreKey(auth.getName(), deviceId, req);
            return ResponseEntity.ok().build();
        } catch (IllegalArgumentException e) {
            return bad(e);
        }
    }

    // ── bundles ───────────────────────────────────────────────────────

    /** Consumes one of the device's one-time prekeys. */
    @GetMapping("/bundle/{username}/{deviceId}")
    public ResponseEntity<SignalKeyService.Bundle> bundle(@PathVariable String username, @PathVariable int deviceId,
                                                          Authentication auth) {
        if (!canSee(auth.getName(), username)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        return keys.fetchBundle(username, deviceId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

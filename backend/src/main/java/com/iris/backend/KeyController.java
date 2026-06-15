package com.iris.backend;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/keys")
public class KeyController {

    private final UserRepository userRepository;
    public KeyController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }
    
    @PostMapping
    public ResponseEntity<Void> setMyKey(@RequestBody PublicKeyRequest req, Authentication auth) {
        User user = userRepository.findByUsername(auth.getName())
                .orElseThrow();

        // INSERT-ONCE. A user's identity key + encrypted backup are published exactly
        // once. If one already exists, this POST is a second device, a race, or a
        // re-upload after IndexedDB loss — anything that would OVERWRITE the existing
        // key and orphan messages already encrypted to it. Refuse with 409 so the
        // client recovers the existing backup instead of generating a new keypair.
        if (user.getPublicKey() != null) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }

        // First publish must be a complete, consistent triple so the server can never
        // hold a public key whose matching backup is missing or from another keypair.
        if (req.publicKey() == null || req.encryptedPrivateKey() == null || req.keySalt() == null) {
            return ResponseEntity.badRequest().build();
        }

        user.setPublicKey(req.publicKey());
        user.setEncryptedPrivateKey(req.encryptedPrivateKey());
        user.setKeySalt(req.keySalt());
        userRepository.save(user);
        return ResponseEntity.ok().build();
    }

    public static record PublicKeyRequest(String publicKey, String encryptedPrivateKey, String keySalt ) { }

    @GetMapping("/{username}")
    public ResponseEntity<String> getKey(@PathVariable String username) {
        return userRepository.findByUsername(username)
                .map(User::getPublicKey)
                .filter(k -> k != null)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/me")
    public MyKeysResponse getMyKeys(Authentication auth) {
        User user = userRepository.findByUsername(auth.getName())
                .orElseThrow();
        return new MyKeysResponse(
            user.getPublicKey(),
            user.getEncryptedPrivateKey(),
            user.getKeySalt()
        );
    }
    public static record MyKeysResponse(
        String publicKey,
        String encryptedPrivateKey,
        String keySalt
    ) { }

}

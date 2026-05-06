package com.iris.backend;

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
        user.setPublicKey(req.publicKey());
        if (req.encryptedPrivateKey() != null) user.setEncryptedPrivateKey(req.encryptedPrivateKey());
        if (req.keySalt() != null) user.setKeySalt(req.keySalt());
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

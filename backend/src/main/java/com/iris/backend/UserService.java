package com.iris.backend;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    static final int SALT_BYTES = 16;
    // Usernames end up in URLs, IndexedDB key prefixes and (deep-linked) routes, so keep
    // them to a separator-free charset. Existing accounts created before this rule keep
    // working — it only applies to new signups.
    static final java.util.regex.Pattern USERNAME = java.util.regex.Pattern.compile("^[A-Za-z0-9_]{3,32}$");
    static final int AUTH_KEY_BYTES = 32;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final byte[] fakeSaltSecret;

    // Constructor injection — Spring auto-wires both
    public UserService(
            UserRepository userRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            @Value("${auth.fake-salt-secret:${jwt.secret}}") String fakeSaltSecret
    ) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.fakeSaltSecret = fakeSaltSecret.getBytes(StandardCharsets.UTF_8);
    }

    public User signup(String username, String authKey, String authSalt) {
        if(username ==null || username.isBlank()){
            throw new IllegalArgumentException("Error: Username and Password cannot be null or blank");
        }
        if(!USERNAME.matcher(username).matches()){
            throw new IllegalArgumentException("Username must be 3–32 characters: letters, numbers and underscores only");
        }
        if(!isBase64OfLength(authKey, AUTH_KEY_BYTES) || !isBase64OfLength(authSalt, SALT_BYTES)){
            throw new IllegalArgumentException("Error: This version of Iris is outdated — please refresh the page");
        }
        if(userRepository.existsByUsername(username)) throw new IllegalStateException("Error: Username already exists");
        User user= new User(username, passwordEncoder.encode(authKey));
        user.setAuthSalt(authSalt);
        user.setCredentialVersion(2);
        userRepository.save(user);
        return user;
    }

    public String login(String username, String rawPassword, String authKey) {
        if(username ==null || username.isBlank()){
            throw new IllegalArgumentException("Invalid Credentials");
        }
        User user = userRepository.findByUsername(username).orElseThrow(() -> new IllegalArgumentException("Invalid credentials"));
        // Each version accepts exactly one credential type, so a v2 account can never
        // be logged into (or downgraded) by presenting a raw password.
        String presented = user.getCredentialVersion() >= 2 ? authKey : rawPassword;
        if(presented == null || presented.isBlank()) throw new IllegalArgumentException("Invalid Credentials");
        if(!passwordEncoder.matches(presented, user.getPasswordHash())) throw new IllegalArgumentException("Invalid Credentials");
        return jwtService.generateToken(username);
    }

    /**
     * Pre-login salt lookup. Unknown usernames get a deterministic fake salt (HMAC of the
     * username) that looks exactly like a real v2 salt, so the endpoint can't enumerate users.
     */
    public SaltResponse saltFor(String username) {
        return userRepository.findByUsername(username)
                .map(u -> u.getCredentialVersion() >= 2
                        ? new SaltResponse(2, u.getAuthSalt())
                        : new SaltResponse(1, null))
                .orElseGet(() -> new SaltResponse(2, fakeSalt(username)));
    }

    /**
     * One-time v1 → v2 migration. Swaps the password hash for bcrypt(authKey) and the
     * private-key backup for one wrapped under the new HKDF KEK, in one transaction.
     * The keypair itself must not change: the re-wrapped backup has to belong to the
     * public key already published, or messages encrypted to it would be orphaned.
     */
    @Transactional
    public void upgradeCredentials(String username, UpgradeRequest req) {
        User user = userRepository.findByUsername(username).orElseThrow();
        if (user.getCredentialVersion() >= 2) {
            throw new IllegalStateException("Account already upgraded");
        }
        // Re-verify the legacy password so a stolen JWT alone can't replace the credential.
        if (req.currentPassword() == null || !passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw new SecurityException("Invalid credentials");
        }
        if (!isBase64OfLength(req.authKey(), AUTH_KEY_BYTES) || !isBase64OfLength(req.authSalt(), SALT_BYTES)) {
            throw new IllegalArgumentException("Malformed credential");
        }

        if (user.getPublicKey() != null) {
            if (!user.getPublicKey().equals(req.publicKey())
                    || req.encryptedPrivateKey() == null
                    || !isBase64OfLength(req.keySalt(), SALT_BYTES)) {
                throw new IllegalArgumentException("Re-wrapped backup must belong to the published public key");
            }
            user.setEncryptedPrivateKey(req.encryptedPrivateKey());
            user.setKeySalt(req.keySalt());
        } else if (req.publicKey() != null || req.encryptedPrivateKey() != null || req.keySalt() != null) {
            // No key published yet — keys go through the insert-once POST /api/keys instead.
            throw new IllegalArgumentException("No key to re-wrap");
        }

        user.setPasswordHash(passwordEncoder.encode(req.authKey()));
        user.setAuthSalt(req.authSalt());
        user.setCredentialVersion(2);
        userRepository.save(user);
    }

    private String fakeSalt(String username) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(fakeSaltSecret, "HmacSHA256"));
            byte[] digest = mac.doFinal(("iris-fake-salt|" + username).getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(Arrays.copyOf(digest, SALT_BYTES));
        } catch (Exception e) {
            throw new IllegalStateException("fake salt derivation failed", e);
        }
    }

    private static boolean isBase64OfLength(String value, int bytes) {
        if (value == null) return false;
        try {
            return Base64.getDecoder().decode(value).length == bytes;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public record SaltResponse(int version, String authSalt) { }

    public record UpgradeRequest(
        String currentPassword,
        String authKey,
        String authSalt,
        String publicKey,
        String encryptedPrivateKey,
        String keySalt
    ) { }
}

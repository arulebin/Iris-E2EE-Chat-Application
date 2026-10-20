package com.iris.backend;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

/**
 * Key directory for the Signal protocol: account identity keys, per-device
 * registrations, signed prekeys, and single-use prekeys.
 *
 * The server only ever holds PUBLIC keys here (plus the identity private key
 * wrapped under a KEK it can't derive). It can withhold or substitute keys —
 * that's what safety numbers and client-side identity pinning catch.
 */
@Service
public class SignalKeyService {

    static final int CURVE_PUBLIC_KEY_BYTES = 33;   // 0x05 ‖ 32-byte X25519 key
    static final int SIGNATURE_BYTES = 64;          // XEdDSA
    static final int MAX_PREKEYS_PER_DEVICE = 200;
    static final int MAX_DEVICES_PER_USER = 10;
    static final int MAX_LABEL = 64;

    private final UserRepository userRepository;
    private final DeviceRepository deviceRepository;
    private final OneTimePreKeyRepository preKeyRepository;
    private final MessageEnvelopeRepository envelopeRepository;

    public SignalKeyService(UserRepository userRepository, DeviceRepository deviceRepository,
                            OneTimePreKeyRepository preKeyRepository, MessageEnvelopeRepository envelopeRepository) {
        this.userRepository = userRepository;
        this.deviceRepository = deviceRepository;
        this.preKeyRepository = preKeyRepository;
        this.envelopeRepository = envelopeRepository;
    }

    public record PreKeyDto(int keyId, String publicKey) { }
    public record SignedPreKeyDto(int keyId, String publicKey, String signature) { }
    public record IdentityPublish(String identityKey, String encryptedIdentityKey, String identityKeySalt, String crossSignature) { }
    public record DeviceRegistration(int registrationId, String label, SignedPreKeyDto signedPreKey, List<PreKeyDto> preKeys) { }
    public record DeviceInfo(int deviceId, int registrationId, String label, Instant createdAt, Instant lastSeen) { }
    public record Bundle(int deviceId, int registrationId, String identityKey, SignedPreKeyDto signedPreKey, PreKeyDto preKey) { }

    // ── validation ────────────────────────────────────────────────────

    static void requireBytes(String b64, int expected, String what) {
        if (b64 == null) throw new IllegalArgumentException(what + " is required");
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(b64);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(what + " is not valid base64");
        }
        if (raw.length != expected) {
            throw new IllegalArgumentException(what + " must be " + expected + " bytes, got " + raw.length);
        }
    }

    static void validateSignedPreKey(SignedPreKeyDto spk) {
        if (spk == null) throw new IllegalArgumentException("signedPreKey is required");
        requireBytes(spk.publicKey(), CURVE_PUBLIC_KEY_BYTES, "signedPreKey.publicKey");
        requireBytes(spk.signature(), SIGNATURE_BYTES, "signedPreKey.signature");
    }

    static void validatePreKeys(List<PreKeyDto> preKeys) {
        if (preKeys == null) return;
        if (preKeys.size() > MAX_PREKEYS_PER_DEVICE) throw new IllegalArgumentException("too many prekeys");
        for (PreKeyDto k : preKeys) requireBytes(k.publicKey(), CURVE_PUBLIC_KEY_BYTES, "preKey.publicKey");
    }

    // ── identity ──────────────────────────────────────────────────────

    /** Insert-once, like the RSA key: overwriting would orphan every session built on it. */
    @Transactional
    public void publishIdentity(String username, IdentityPublish req) {
        User user = userRepository.findByUsername(username).orElseThrow();
        if (user.getIdentityKey() != null) throw new IllegalStateException("identity already published");
        requireBytes(req.identityKey(), CURVE_PUBLIC_KEY_BYTES, "identityKey");
        if (req.encryptedIdentityKey() == null || req.identityKeySalt() == null) {
            throw new IllegalArgumentException("encrypted identity backup is required");
        }
        user.setIdentityKey(req.identityKey());
        user.setEncryptedIdentityKey(req.encryptedIdentityKey());
        user.setIdentityKeySalt(req.identityKeySalt());
        user.setIdentityCrossSignature(req.crossSignature());
        userRepository.save(user);
    }

    // ── devices ───────────────────────────────────────────────────────

    @Transactional
    public int registerDevice(String username, DeviceRegistration req) {
        User user = userRepository.findByUsername(username).orElseThrow();
        if (user.getIdentityKey() == null) throw new IllegalStateException("publish an identity key first");
        validateSignedPreKey(req.signedPreKey());
        validatePreKeys(req.preKeys());
        if (deviceRepository.findByUsernameOrderByDeviceIdAsc(username).size() >= MAX_DEVICES_PER_USER) {
            throw new IllegalArgumentException("device limit reached — remove an old device first");
        }
        int deviceId = user.allocateDeviceId();
        userRepository.save(user);

        String label = req.label() == null ? null : req.label().substring(0, Math.min(req.label().length(), MAX_LABEL));
        deviceRepository.save(new Device(username, deviceId, req.registrationId(),
            req.signedPreKey().keyId(), req.signedPreKey().publicKey(), req.signedPreKey().signature(), label));
        storePreKeys(username, deviceId, req.preKeys());
        return deviceId;
    }

    public List<DeviceInfo> listDevices(String username) {
        return deviceRepository.findByUsernameOrderByDeviceIdAsc(username).stream()
            .map(d -> new DeviceInfo(d.getDeviceId(), d.getRegistrationId(), d.getLabel(), d.getCreatedAt(), d.getLastSeen()))
            .toList();
    }

    public List<Integer> deviceIds(String username) {
        return deviceRepository.findByUsernameOrderByDeviceIdAsc(username).stream().map(Device::getDeviceId).toList();
    }

    public boolean deviceExists(String username, int deviceId) {
        return deviceRepository.existsByUsernameAndDeviceId(username, deviceId);
    }

    /** Remove a device and everything addressed to it. Returns false if it didn't exist. */
    @Transactional
    public boolean removeDevice(String username, int deviceId) {
        Optional<Device> device = deviceRepository.findByUsernameAndDeviceId(username, deviceId);
        if (device.isEmpty()) return false;
        preKeyRepository.deleteAllFor(username, deviceId);
        envelopeRepository.deleteAllFor(username, deviceId);
        deviceRepository.delete(device.get());
        return true;
    }

    public void touch(String username, int deviceId) {
        deviceRepository.touch(username, deviceId, Instant.now());
    }

    // ── prekeys ───────────────────────────────────────────────────────

    @Transactional
    public void storePreKeys(String username, int deviceId, List<PreKeyDto> preKeys) {
        if (preKeys == null || preKeys.isEmpty()) return;
        validatePreKeys(preKeys);
        long existing = preKeyRepository.countByUsernameAndDeviceId(username, deviceId);
        if (existing + preKeys.size() > MAX_PREKEYS_PER_DEVICE) {
            throw new IllegalArgumentException("prekey limit exceeded");
        }
        for (PreKeyDto k : preKeys) {
            if (preKeyRepository.existsByUsernameAndDeviceIdAndKeyId(username, deviceId, k.keyId())) continue;
            preKeyRepository.save(new OneTimePreKey(username, deviceId, k.keyId(), k.publicKey()));
        }
    }

    public long preKeyCount(String username, int deviceId) {
        return preKeyRepository.countByUsernameAndDeviceId(username, deviceId);
    }

    @Transactional
    public void rotateSignedPreKey(String username, int deviceId, SignedPreKeyDto spk) {
        validateSignedPreKey(spk);
        Device device = deviceRepository.findByUsernameAndDeviceId(username, deviceId).orElseThrow();
        device.rotateSignedPreKey(spk.keyId(), spk.publicKey(), spk.signature());
        deviceRepository.save(device);
    }

    /**
     * Prekey bundle for one device, consuming one one-time prekey if any are left.
     * The claim is a conditional DELETE, so two concurrent fetchers can never be
     * handed the same key; the loser just tries the next one. With none left the
     * bundle has no preKey and X3DH runs on the signed prekey alone (still secure,
     * slightly weaker replay protection for the first message).
     */
    public Optional<Bundle> fetchBundle(String username, int deviceId) {
        User user = userRepository.findByUsername(username).orElse(null);
        if (user == null || user.getIdentityKey() == null) return Optional.empty();
        Device device = deviceRepository.findByUsernameAndDeviceId(username, deviceId).orElse(null);
        if (device == null) return Optional.empty();

        PreKeyDto claimed = null;
        for (int attempt = 0; attempt < 5 && claimed == null; attempt++) {
            List<OneTimePreKey> candidates = preKeyRepository.findOldest(username, deviceId, PageRequest.of(0, 1));
            if (candidates.isEmpty()) break;
            OneTimePreKey k = candidates.get(0);
            if (preKeyRepository.claim(k.getId()) == 1) claimed = new PreKeyDto(k.getKeyId(), k.getPublicKey());
        }

        return Optional.of(new Bundle(
            device.getDeviceId(),
            device.getRegistrationId(),
            user.getIdentityKey(),
            new SignedPreKeyDto(device.getSignedPreKeyId(), device.getSignedPreKey(), device.getSignedPreKeySignature()),
            claimed
        ));
    }
}

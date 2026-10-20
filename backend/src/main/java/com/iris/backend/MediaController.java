package com.iris.backend;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/api/media")
public class MediaController {

    private static final long MAX_BYTES = 50L * 1024 * 1024; // 50 MB
    private static final String E2E_EXT = ".e2e";    // client-encrypted, stored opaque
    private static final String LEGACY_EXT = ".bin"; // server-encrypted at rest (MediaEncryption)

    @Value("${media.storage-dir:./data/media}")
    private String storageDirProp;

    private final MediaEncryption encryption;
    private final MessageRepository messageRepository;

    private Path storageDir;

    public MediaController(MediaEncryption encryption, MessageRepository messageRepository) {
        this.encryption = encryption;
        this.messageRepository = messageRepository;
    }

    @PostConstruct
    void init() throws IOException {
        this.storageDir = Paths.get(storageDirProp);
        Files.createDirectories(storageDir);
    }

    @PostMapping
    public ResponseEntity<UploadResponse> upload(
            @RequestParam("file") MultipartFile file,
            Authentication auth
    ) throws IOException {
        if (file.isEmpty()) return ResponseEntity.badRequest().build();
        if (file.getSize() > MAX_BYTES) {
            return ResponseEntity.status(413).build(); // Payload Too Large
        }

        String mimeType = file.getContentType() == null
                ? "application/octet-stream"
                : file.getContentType();

        String mediaId = UUID.randomUUID().toString();

        // Current clients encrypt in the browser and upload opaque ciphertext. We store
        // it byte-for-byte as <id>.e2e — the server never holds the key or the plaintext.
        if (mimeType.startsWith("application/octet-stream")) {
            byte[] ciphertext = file.getBytes();
            Files.write(storageDir.resolve(mediaId + E2E_EXT), ciphertext);
            return ResponseEntity.ok(new UploadResponse(mediaId, mimeType, ciphertext.length));
        }

        // LEGACY: a stale (pre-E2E) client still uploading a plaintext image/video.
        // Keep accepting it with server-side encryption at rest so old tabs don't break.
        if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
            return ResponseEntity.badRequest().build();
        }

        byte[] plaintext = file.getBytes();
        byte[] encrypted = encryption.encrypt(plaintext);

        Path target = storageDir.resolve(mediaId + LEGACY_EXT);
        Files.write(target, encrypted);

        return ResponseEntity.ok(new UploadResponse(mediaId, mimeType, plaintext.length));
    }

    @PostMapping("/profile")
    public ResponseEntity<UploadResponse> uploadProfilePic(
            @RequestParam("file") MultipartFile file,
            Authentication auth
    ) throws IOException {
        if (file.isEmpty()) return ResponseEntity.badRequest().build();
        if (file.getSize() > 5L * 1024 * 1024) { 
            return ResponseEntity.status(413).build();
        }

        String mimeType = file.getContentType();
        if (mimeType == null || !mimeType.startsWith("image/")) {
            return ResponseEntity.badRequest().build();
        }

        String ext = mimeType.replace("image/", "");
        if (ext.equals("jpeg")) ext = "jpg";
        
        String mediaId = "prof_" + UUID.randomUUID().toString();
        Path target = storageDir.resolve(mediaId + "." + ext);
        file.transferTo(target);

        return ResponseEntity.ok(new UploadResponse(mediaId + "." + ext, mimeType, file.getSize()));
    }

    @GetMapping("/{mediaId}")
    public ResponseEntity<Resource> download(
            @PathVariable String mediaId,
            Authentication auth
    ) throws IOException {
        Message msg = messageRepository.findByMediaId(mediaId).orElse(null);
        if (msg == null) return ResponseEntity.notFound().build();

        String me = auth.getName();
        boolean isSender = me.equals(msg.getSender());
        boolean isRecipient = me.equals(msg.getRecipient());
        if (!isSender && !isRecipient) {
            return ResponseEntity.status(403).build();
        }

        if (msg.isViewOnce() && msg.getViewedAt() != null) {
            return ResponseEntity.status(410).build(); // Gone
        }

        if (msg.isViewOnce() && isSender) {
            return ResponseEntity.status(403).build();
        }

        // E2E blobs are served as-is (the client decrypts); legacy .bin files were
        // encrypted at rest with the server master key and are decrypted here.
        Path e2eFile = storageDir.resolve(mediaId + E2E_EXT);
        boolean isE2e = Files.exists(e2eFile);
        Path file = isE2e ? e2eFile : storageDir.resolve(mediaId + LEGACY_EXT);
        if (!Files.exists(file)) return ResponseEntity.notFound().build();

        byte[] stored = Files.readAllBytes(file);
        byte[] body = isE2e ? stored : encryption.decrypt(stored);

        if (msg.isViewOnce() && isRecipient && msg.getViewedAt() == null) {
            msg.setViewedAt(Instant.now());
            messageRepository.save(msg);
            try {
                Files.deleteIfExists(file);
            } catch (IOException e) {
            }
        }

        // The client relies on octet-stream meaning "ciphertext — decrypt me".
        MediaType type = MediaType.APPLICATION_OCTET_STREAM;
        if (!isE2e) {
            try {
                type = MediaType.parseMediaType(msg.getMimeType());
            } catch (Exception e) {
                type = MediaType.APPLICATION_OCTET_STREAM;
            }
        }

        String cache = msg.isViewOnce() ? "no-store" : "private, max-age=3600";

        return ResponseEntity.ok()
                .contentType(type)
                .contentLength(body.length)
                .header(HttpHeaders.CACHE_CONTROL, cache)
                .body(new ByteArrayResource(body));
    }

    @GetMapping("/profile/{filename}")
    public ResponseEntity<Resource> downloadProfilePic(
            @PathVariable String filename
    ) throws IOException {
        Path file = storageDir.resolve(filename);
        if (!Files.exists(file) || !filename.startsWith("prof_")) return ResponseEntity.notFound().build();

        byte[] plaintext = Files.readAllBytes(file);
        
        String mimeType = "image/" + filename.substring(filename.lastIndexOf('.') + 1);
        if (mimeType.equals("image/jpg")) mimeType = "image/jpeg";
        MediaType type;
        try {
            type = MediaType.parseMediaType(mimeType);
        } catch (Exception e) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }

        return ResponseEntity.ok()
                .contentType(type)
                .contentLength(plaintext.length)
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=86400")
                .body(new ByteArrayResource(plaintext));
    }

    public record UploadResponse(String mediaId, String mimeType, long size) {}
}

package com.iris.backend;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.InputStreamResource;
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
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/media")
public class MediaController {

    private static final long MAX_BYTES = 50L * 1024 * 1024; // 50 MB
    private static final String E2E_EXT = ".e2e";    // client-encrypted, stored opaque
    private static final String LEGACY_EXT = ".bin"; // server-encrypted at rest (MediaEncryption)

    // Profile pictures: raster formats only, stored as prof_<uuid>.<ext>
    private static final Map<String, String> PROFILE_EXTENSIONS = Map.of(
            "image/jpeg", "jpg",
            "image/png",  "png",
            "image/webp", "webp",
            "image/gif",  "gif"
    );
    private static final Pattern PROFILE_FILENAME = Pattern.compile(
            "prof_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp|gif)");

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
        this.storageDir = Paths.get(storageDirProp).toAbsolutePath().normalize();
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
        // Streamed from the multipart temp file straight to disk: a 50 MB upload must not
        // occupy 50 MB of a small heap.
        if (mimeType.startsWith("application/octet-stream")) {
            long size = file.getSize();
            file.transferTo(storageDir.resolve(mediaId + E2E_EXT));
            return ResponseEntity.ok(new UploadResponse(mediaId, mimeType, size));
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

        // Allowlist: the Content-Type is client-controlled and becomes the file extension,
        // so anything else could inject path segments or serve active content (SVG).
        String ext = PROFILE_EXTENSIONS.get(file.getContentType());
        if (ext == null) {
            return ResponseEntity.badRequest().build();
        }
        String mimeType = file.getContentType();

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

        boolean consumeOnce = msg.isViewOnce() && isRecipient && msg.getViewedAt() == null;
        if (consumeOnce) {
            msg.setViewedAt(Instant.now());
            messageRepository.save(msg);
        }

        String cache = msg.isViewOnce() ? "no-store" : "private, max-age=3600";

        // E2E ciphertext is streamed from disk (never held in the heap). A view-once
        // file is opened DELETE_ON_CLOSE, so it disappears as soon as it's been sent.
        if (isE2e) {
            long size = Files.size(file);
            Resource resource = consumeOnce
                    ? new InputStreamResource(Files.newInputStream(file, StandardOpenOption.DELETE_ON_CLOSE))
                    : new FileSystemResource(file);
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_OCTET_STREAM)
                    .contentLength(size)
                    .header(HttpHeaders.CACHE_CONTROL, cache)
                    .body(resource);
        }

        // LEGACY .bin: decrypted with the server key, so it has to pass through memory.
        byte[] body = encryption.decrypt(Files.readAllBytes(file));
        if (consumeOnce) {
            try {
                Files.deleteIfExists(file);
            } catch (IOException e) {
            }
        }

        // The client relies on octet-stream meaning "ciphertext — decrypt me", so a
        // legacy (already decrypted) body carries its real type.
        MediaType type;
        try {
            type = MediaType.parseMediaType(msg.getMimeType());
        } catch (Exception e) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }

        return ResponseEntity.ok()
                .contentType(type)
                .contentLength(body.length)
                .header(HttpHeaders.CACHE_CONTROL, cache)
                .body(new ByteArrayResource(body));
    }

    // Requires a valid JWT (not permitAll in SecurityConfig); the frontend fetches with the token.
    @GetMapping("/profile/{filename}")
    public ResponseEntity<Resource> downloadProfilePic(
            @PathVariable String filename
    ) throws IOException {
        Matcher m = PROFILE_FILENAME.matcher(filename);
        if (!m.matches()) return ResponseEntity.notFound().build();

        Path file = storageDir.resolve(filename).normalize();
        if (!file.startsWith(storageDir) || !Files.exists(file)) return ResponseEntity.notFound().build();

        String mimeType = m.group(1).equals("jpg") ? "image/jpeg" : "image/" + m.group(1);

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(mimeType))
                .contentLength(Files.size(file))
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=86400")
                .header("X-Content-Type-Options", "nosniff")
                .body(new FileSystemResource(file));
    }

    public record UploadResponse(String mediaId, String mimeType, long size) {}
}

package com.iris.backend;

import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.Map;

/**
 * End-to-end encrypted message-history backup. The blob is AES-GCM ciphertext
 * under a key derived from the user's recovery key, which never leaves their
 * devices — the server stores it opaquely and can't read or verify it.
 * One latest version per account, stored on disk next to media.
 */
@RestController
@RequestMapping("/api/backup")
public class BackupController {

    static final long MAX_BACKUP_BYTES = 25L * 1024 * 1024;

    @Value("${media.storage-dir:./data/media}")
    private String storageDirProp;

    private final UserRepository userRepository;
    private Path backupDir;

    public BackupController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @PostConstruct
    void init() throws IOException {
        backupDir = Paths.get(storageDirProp).toAbsolutePath().normalize().resolve("backups");
        Files.createDirectories(backupDir);
    }

    // Keyed by the numeric user id so usernames never become file names.
    private Path fileFor(Authentication auth) {
        Long id = userRepository.findByUsername(auth.getName()).orElseThrow().getId();
        return backupDir.resolve(id + ".bin");
    }

    // Non-secret identifier of the recovery key the current backup was made with
    // (a hash the client derives from it). Lets a device notice that another device
    // switched to a new recovery key instead of silently overwriting its backup.
    private Path keyIdFileFor(Path backupFile) {
        return backupFile.resolveSibling(backupFile.getFileName().toString().replace(".bin", ".keyid"));
    }

    private static boolean validKeyId(String keyId) {
        return keyId != null && keyId.matches("[0-9a-f]{16,64}");
    }

    @GetMapping("/meta")
    public Map<String, Object> meta(Authentication auth) throws IOException {
        Path file = fileFor(auth);
        if (!Files.exists(file)) return Map.of("exists", false);
        Path keyIdFile = keyIdFileFor(file);
        return Map.of(
            "exists", true,
            "size", Files.size(file),
            "updatedAt", Files.getLastModifiedTime(file).toInstant().toString(),
            "keyId", Files.exists(keyIdFile) ? Files.readString(keyIdFile) : ""
        );
    }

    // Streamed from disk — never the whole blob in the heap.
    @GetMapping
    public ResponseEntity<Resource> download(Authentication auth) throws IOException {
        Path file = fileFor(auth);
        if (!Files.exists(file)) return ResponseEntity.notFound().build();
        FileTime modified = Files.getLastModifiedTime(file);
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .contentLength(Files.size(file))
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .header("X-Backup-Updated", modified.toInstant().toString())
            .body(new FileSystemResource(file));
    }

    @PutMapping(consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Object> upload(@RequestHeader(value = HttpHeaders.CONTENT_LENGTH, required = false) Long declared,
                                         @RequestHeader(value = "X-Backup-Key-Id", required = false) String keyId,
                                         HttpServletRequest request, Authentication auth) throws IOException {
        if (!validKeyId(keyId)) return ResponseEntity.badRequest().body(Map.of("error", "missing key id"));
        // Caddy caps bodies at 52 MB; this is the application-level limit.
        if (declared != null && declared > MAX_BACKUP_BYTES) return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build();

        // Streamed to a temp file (capped even if Content-Length lied), then renamed into
        // place so a crash mid-upload never leaves a truncated backup.
        Path target = fileFor(auth);
        Path tmp = Files.createTempFile(backupDir, "upload-", ".tmp");
        try {
            long written;
            try (InputStream in = request.getInputStream();
                 OutputStream out = Files.newOutputStream(tmp)) {
                written = copyCapped(in, out, MAX_BACKUP_BYTES);
            }
            if (written < 0) return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build();
            if (written == 0) return ResponseEntity.badRequest().build();
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(tmp);
        }
        Files.writeString(keyIdFileFor(target), keyId);
        return ResponseEntity.ok(Map.of("updatedAt", Files.getLastModifiedTime(target).toInstant().toString()));
    }

    /** Copies at most {@code max} bytes; returns the count, or -1 if the input was longer. */
    static long copyCapped(InputStream in, OutputStream out, long max) throws IOException {
        byte[] buf = new byte[64 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > max) return -1;
            out.write(buf, 0, n);
        }
        return total;
    }

    @DeleteMapping
    public ResponseEntity<Void> delete(Authentication auth) throws IOException {
        Path file = fileFor(auth);
        Files.deleteIfExists(file);
        Files.deleteIfExists(keyIdFileFor(file));
        return ResponseEntity.noContent().build();
    }
}

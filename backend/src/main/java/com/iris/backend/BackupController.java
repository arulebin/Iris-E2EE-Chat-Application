package com.iris.backend;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
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

    @GetMapping("/meta")
    public Map<String, Object> meta(Authentication auth) throws IOException {
        Path file = fileFor(auth);
        if (!Files.exists(file)) return Map.of("exists", false);
        return Map.of(
            "exists", true,
            "size", Files.size(file),
            "updatedAt", Files.getLastModifiedTime(file).toInstant().toString()
        );
    }

    @GetMapping
    public ResponseEntity<byte[]> download(Authentication auth) throws IOException {
        Path file = fileFor(auth);
        if (!Files.exists(file)) return ResponseEntity.notFound().build();
        FileTime modified = Files.getLastModifiedTime(file);
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .header("X-Backup-Updated", modified.toInstant().toString())
            .body(Files.readAllBytes(file));
    }

    @PutMapping(consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Object> upload(@RequestHeader(value = HttpHeaders.CONTENT_LENGTH, required = false) Long declared,
                                         @RequestBody byte[] body, Authentication auth) throws IOException {
        // nginx caps bodies at 51 MB; this is the application-level limit.
        if (declared != null && declared > MAX_BACKUP_BYTES) return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build();
        if (body == null || body.length == 0) return ResponseEntity.badRequest().build();
        if (body.length > MAX_BACKUP_BYTES) return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).build();

        // Write-then-rename so a crash mid-upload never leaves a truncated backup.
        Path target = fileFor(auth);
        Path tmp = Files.createTempFile(backupDir, "upload-", ".tmp");
        try {
            Files.write(tmp, body);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(tmp);
        }
        return ResponseEntity.ok(Map.of("updatedAt", Files.getLastModifiedTime(target).toInstant().toString()));
    }

    @DeleteMapping
    public ResponseEntity<Void> delete(Authentication auth) throws IOException {
        Files.deleteIfExists(fileFor(auth));
        return ResponseEntity.noContent().build();
    }
}

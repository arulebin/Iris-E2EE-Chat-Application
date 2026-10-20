package com.iris.backend;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

@Component
public class ShareIdMigrator implements ApplicationRunner {

    private final JdbcTemplate jdbc;

    public ShareIdMigrator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // UUIDs are generated in Java rather than SQL (H2's RANDOM_UUID() vs Postgres'
    // gen_random_uuid()) so this runs unchanged on every database we support.
    @Override
    public void run(ApplicationArguments args) {
        List<Long> ids = jdbc.queryForList("SELECT id FROM users WHERE share_id IS NULL", Long.class);
        int updated = 0;
        for (Long id : ids) {
            updated += jdbc.update(
                "UPDATE users SET share_id = ? WHERE id = ? AND share_id IS NULL",
                UUID.randomUUID().toString(), id
            );
        }
        if (updated > 0) {
            System.out.println("[Migration] Assigned share_id to " + updated + " existing user(s)");
        }
    }
}

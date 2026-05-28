package com.iris.backend;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class ShareIdMigrator implements ApplicationRunner {

    private final JdbcTemplate jdbc;

    public ShareIdMigrator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        int updated = jdbc.update(
            "UPDATE users SET share_id = RANDOM_UUID() WHERE share_id IS NULL"
        );
        if (updated > 0) {
            System.out.println("[Migration] Assigned share_id to " + updated + " existing user(s)");
        }
    }
}

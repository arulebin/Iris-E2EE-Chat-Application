package com.iris.backend;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * ddl-auto=update adds columns but never changes an existing column's type, so
 * columns widened in the entities are migrated here, once, on Postgres.
 * (varchar → text is a catalog-only change in Postgres: no table rewrite.)
 */
@Component
public class ColumnTypeMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ColumnTypeMigrator.class);

    private record Col(String table, String column) { }

    private static final List<Col> TO_TEXT = List.of(
        new Col("messages", "content")
    );

    private final JdbcTemplate jdbc;

    public ColumnTypeMigrator(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        String product = jdbc.execute((java.sql.Connection c) -> c.getMetaData().getDatabaseProductName());
        if (product == null || !product.toLowerCase().contains("postgres")) return;
        for (Col c : TO_TEXT) {
            List<String> types = jdbc.queryForList(
                "SELECT data_type FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
                String.class, c.table(), c.column());
            if (types.isEmpty() || "text".equals(types.get(0))) continue;
            // Identifiers come from the constant list above, never from input.
            jdbc.execute("ALTER TABLE " + c.table() + " ALTER COLUMN " + c.column() + " TYPE TEXT");
            log.info("[Migration] {}.{} widened from {} to text", c.table(), c.column(), types.get(0));
        }
    }
}

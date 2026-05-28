package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.List;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    Optional<User> findByShareId(String shareId);

    boolean existsByUsername(String username);

    @Query("SELECT u FROM User u WHERE LOWER(u.username) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(u.preferredName) LIKE LOWER(CONCAT('%', :q, '%'))")
    List<User> searchUsers(@Param("q") String q);

    @Query("""
        SELECT DISTINCT u FROM User u
        WHERE u.username IN (
            SELECT m.sender FROM Message m WHERE m.recipient = :username
        ) OR u.username IN (
            SELECT m.recipient FROM Message m WHERE m.sender = :username
        )
    """)
    List<User> findUsersWithHistory(@Param("username") String username);
}

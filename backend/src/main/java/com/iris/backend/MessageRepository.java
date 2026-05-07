package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MessageRepository extends JpaRepository<Message, Long> {

    List<Message> findTop50ByOrderBySentAtDesc();

    @Query("""
        SELECT m FROM Message m
        WHERE (m.sender = :a AND m.recipient = :b)
           OR (m.sender = :b AND m.recipient = :a)
        ORDER BY m.sentAt ASC
    """)
    List<Message> findConversation(@Param("a") String a, @Param("b") String b);

    java.util.Optional<Message> findByMediaId(String mediaId);
}

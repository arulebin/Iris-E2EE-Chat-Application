package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
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

    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE Message m SET m.readAt = :now WHERE m.sender = :sender AND m.recipient = :recipient AND m.readAt IS NULL")
    int markRead(@Param("sender") String sender, @Param("recipient") String recipient, @Param("now") Instant now);
}

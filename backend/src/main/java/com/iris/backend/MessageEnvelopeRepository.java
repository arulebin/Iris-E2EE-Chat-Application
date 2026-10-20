package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

public interface MessageEnvelopeRepository extends JpaRepository<MessageEnvelope, Long> {

    List<MessageEnvelope> findByTargetUserAndTargetDeviceIdOrderByIdAsc(String targetUser, int targetDeviceId);

    /** Ack: only removes envelopes that really belong to the acking device. */
    @Transactional
    @Modifying
    @Query("DELETE FROM MessageEnvelope e WHERE e.id IN :ids AND e.targetUser = :user AND e.targetDeviceId = :deviceId")
    int ack(@Param("ids") Collection<Long> ids, @Param("user") String user, @Param("deviceId") int deviceId);

    @Transactional
    @Modifying
    @Query("DELETE FROM MessageEnvelope e WHERE e.targetUser = :user AND e.targetDeviceId = :deviceId")
    int deleteAllFor(@Param("user") String user, @Param("deviceId") int deviceId);
}

package com.iris.backend;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

public interface RefreshSessionRepository extends JpaRepository<RefreshSession, Long> {

    // Row lock: two concurrent refreshes of the same token must not both succeed.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM RefreshSession s WHERE s.tokenHash = :hash")
    Optional<RefreshSession> findForUpdate(@Param("hash") String tokenHash);

    @Modifying
    @Query("UPDATE RefreshSession s SET s.revokedAt = :now, s.revokeReason = :reason "
         + "WHERE s.familyId = :familyId AND s.revokedAt IS NULL")
    int revokeFamily(@Param("familyId") String familyId, @Param("now") Instant now, @Param("reason") String reason);

    @Modifying
    @Query("UPDATE RefreshSession s SET s.revokedAt = :now, s.revokeReason = 'DEVICE' "
         + "WHERE s.username = :username AND s.deviceId = :deviceId AND s.revokedAt IS NULL")
    int revokeDevice(@Param("username") String username, @Param("deviceId") int deviceId, @Param("now") Instant now);

    @Modifying
    @Query("DELETE FROM RefreshSession s WHERE s.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}

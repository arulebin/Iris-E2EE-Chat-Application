package com.iris.backend;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface OneTimePreKeyRepository extends JpaRepository<OneTimePreKey, Long> {

    long countByUsernameAndDeviceId(String username, int deviceId);

    boolean existsByUsernameAndDeviceIdAndKeyId(String username, int deviceId, int keyId);

    @Query("SELECT k FROM OneTimePreKey k WHERE k.username = :username AND k.deviceId = :deviceId ORDER BY k.id ASC")
    List<OneTimePreKey> findOldest(@Param("username") String username, @Param("deviceId") int deviceId, Pageable page);

    /** Claim a key: returns 1 only for the caller whose DELETE actually removed it. */
    @Transactional
    @Modifying
    @Query("DELETE FROM OneTimePreKey k WHERE k.id = :id")
    int claim(@Param("id") Long id);

    @Transactional
    @Modifying
    @Query("DELETE FROM OneTimePreKey k WHERE k.username = :username AND k.deviceId = :deviceId")
    int deleteAllFor(@Param("username") String username, @Param("deviceId") int deviceId);
}

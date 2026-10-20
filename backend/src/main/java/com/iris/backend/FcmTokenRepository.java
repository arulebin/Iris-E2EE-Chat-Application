package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

public interface FcmTokenRepository extends JpaRepository<FcmToken, Long> {
    List<FcmToken> findByUsername(String username);
    Optional<FcmToken> findByToken(String token);

    /** A removed Signal device's push registrations (it can never fetch its envelopes again). */
    @Transactional
    @Modifying
    @Query("DELETE FROM FcmToken t WHERE t.username = :username AND t.deviceId = :deviceId")
    int deleteForDevice(@Param("username") String username, @Param("deviceId") int deviceId);
}

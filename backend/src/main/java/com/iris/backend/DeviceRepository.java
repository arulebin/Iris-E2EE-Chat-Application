package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface DeviceRepository extends JpaRepository<Device, Long> {

    List<Device> findByUsernameOrderByDeviceIdAsc(String username);

    Optional<Device> findByUsernameAndDeviceId(String username, int deviceId);

    boolean existsByUsernameAndDeviceId(String username, int deviceId);

    @Transactional
    @Modifying
    @Query("UPDATE Device d SET d.lastSeen = :now WHERE d.username = :username AND d.deviceId = :deviceId")
    int touch(@Param("username") String username, @Param("deviceId") int deviceId, @Param("now") Instant now);
}

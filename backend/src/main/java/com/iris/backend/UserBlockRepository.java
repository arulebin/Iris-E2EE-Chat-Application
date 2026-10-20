package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface UserBlockRepository extends JpaRepository<UserBlock, Long> {

    boolean existsByBlockerAndBlocked(String blocker, String blocked);

    List<UserBlock> findByBlockerOrderByCreatedAtDesc(String blocker);

    @Query("SELECT COUNT(b) > 0 FROM UserBlock b WHERE " +
           "(b.blocker = :a AND b.blocked = :b) OR (b.blocker = :b AND b.blocked = :a)")
    boolean existsBetween(@Param("a") String a, @Param("b") String b);

    @Modifying
    @Transactional
    @Query("DELETE FROM UserBlock b WHERE b.blocker = :blocker AND b.blocked = :blocked")
    int deleteBlock(@Param("blocker") String blocker, @Param("blocked") String blocked);
}

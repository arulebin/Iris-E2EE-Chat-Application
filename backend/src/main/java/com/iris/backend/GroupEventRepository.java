package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface GroupEventRepository extends JpaRepository<GroupEvent, Long> {

    List<GroupEvent> findTop500ByGroupIdOrderByIdDesc(String groupId);

    @Modifying
    @Query("DELETE FROM GroupEvent e WHERE e.groupId = :groupId")
    void deleteByGroupId(@Param("groupId") String groupId);
}

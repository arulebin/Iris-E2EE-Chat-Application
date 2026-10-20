package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface GroupMemberRepository extends JpaRepository<GroupMember, Long> {

    List<GroupMember> findByGroupIdOrderByJoinedAtAsc(String groupId);

    List<GroupMember> findByUsername(String username);

    Optional<GroupMember> findByGroupIdAndUsername(String groupId, String username);

    boolean existsByGroupIdAndUsername(String groupId, String username);

    long countByGroupId(String groupId);

    @Query("""
        SELECT COUNT(a) > 0 FROM GroupMember a, GroupMember b
        WHERE a.groupId = b.groupId AND a.username = :x AND b.username = :y
    """)
    boolean shareAGroup(@Param("x") String x, @Param("y") String y);

    @Modifying
    @Query("DELETE FROM GroupMember m WHERE m.groupId = :groupId")
    void deleteByGroupId(@Param("groupId") String groupId);
}

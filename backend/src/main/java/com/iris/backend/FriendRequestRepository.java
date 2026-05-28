package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface FriendRequestRepository extends JpaRepository<FriendRequest, Long> {

    List<FriendRequest> findByToUserAndStatus(String toUser, FriendRequest.Status status);

    boolean existsByFromUserAndToUserAndStatus(String fromUser, String toUser, FriendRequest.Status status);

    @Query("SELECT fr FROM FriendRequest fr WHERE (fr.fromUser = :user OR fr.toUser = :user) AND fr.status = 'ACCEPTED'")
    List<FriendRequest> findAcceptedByUser(@Param("user") String user);
}

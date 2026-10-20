package com.iris.backend;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface FriendRequestRepository extends JpaRepository<FriendRequest, Long> {

    List<FriendRequest> findByToUserAndStatus(String toUser, FriendRequest.Status status);

    boolean existsByFromUserAndToUserAndStatus(String fromUser, String toUser, FriendRequest.Status status);

    // The single directed row between two users (unique on from_user + to_user).
    Optional<FriendRequest> findByFromUserAndToUser(String fromUser, String toUser);

    @Query("SELECT fr FROM FriendRequest fr WHERE (fr.fromUser = :user OR fr.toUser = :user) AND fr.status = 'ACCEPTED'")
    List<FriendRequest> findAcceptedByUser(@Param("user") String user);

    @Query("SELECT COUNT(fr) > 0 FROM FriendRequest fr WHERE fr.status = 'ACCEPTED' AND " +
           "((fr.fromUser = :a AND fr.toUser = :b) OR (fr.fromUser = :b AND fr.toUser = :a))")
    boolean existsAcceptedBetween(@Param("a") String a, @Param("b") String b);
}

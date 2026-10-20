package com.iris.backend;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Who may see or reach whom. Rules:
 *  - Public profiles appear in search; anyone can see name/avatar and send a request.
 *  - Private profiles never appear in search; non-friends see only the username,
 *    and can only reach them with a valid invite code (or by accepting a request
 *    the private user sent first).
 *  - A block in either direction hides both sides from each other's search/lookups
 *    and stops messages, calls and requests. The blocked side is never told.
 */
@Service
public class PrivacyService {

    private final UserRepository users;
    private final FriendRequestRepository friends;
    private final UserBlockRepository blocks;

    public PrivacyService(UserRepository users, FriendRequestRepository friends, UserBlockRepository blocks) {
        this.users = users;
        this.friends = friends;
        this.blocks = blocks;
    }

    public boolean isBlockedEitherWay(String a, String b) {
        return blocks.existsBetween(a, b);
    }

    public boolean haveBlocked(String blocker, String blocked) {
        return blocks.existsByBlockerAndBlocked(blocker, blocked);
    }

    /** Full profile for self, friends and public accounts; bare username otherwise. */
    public UserProfileDto profileFor(String viewer, User target) {
        if (target.getUsername().equals(viewer)) return UserProfileDto.from(target);
        if (!target.isPrivateProfile()) return UserProfileDto.from(target);
        if (friends.existsAcceptedUnblockedBetween(viewer, target.getUsername())) {
            // Friends see name and avatar, but not the share id: there's nothing to request.
            return new UserProfileDto(target.getUsername(), target.getPreferredName(), target.getAvatarUrl(), null);
        }
        return UserProfileDto.redacted(target);
    }

    /** Lookup by username honoring privacy: private non-friends and blocks look like "not found". */
    public Optional<User> visibleByUsername(String viewer, String username) {
        return users.findByUsername(username).filter(u ->
                u.getUsername().equals(viewer)
                || (!isBlockedEitherWay(viewer, u.getUsername())
                    && (!u.isPrivateProfile() || friends.existsAcceptedUnblockedBetween(viewer, u.getUsername()))));
    }

    public List<User> search(String viewer, String q) {
        return users.searchDiscoverable(q).stream()
                .filter(u -> !u.getUsername().equals(viewer))
                .filter(u -> !isBlockedEitherWay(viewer, u.getUsername()))
                .toList();
    }

    /** The account an invite code points at, if the code is valid and invites are on. */
    public Optional<User> byInviteCode(String rawCode) {
        String code = InviteCodes.normalize(rawCode);
        if (code == null) return Optional.empty();
        return users.findByInviteCode(code).filter(User::isInvitesEnabled);
    }

    /** Legacy share-id (UUID) lookup: only reaches discoverable accounts. */
    public Optional<User> byShareId(String shareId) {
        return users.findByShareId(shareId).filter(u -> !u.isPrivateProfile());
    }

    /** Current code, issuing one on first use. */
    @Transactional
    public String ensureInviteCode(User user) {
        if (user.getInviteCode() == null) {
            user.setInviteCode(freshCode());
            users.save(user);
        }
        return user.getInviteCode();
    }

    /** New code; the old link/QR stops working immediately. */
    @Transactional
    public String rotateInviteCode(User user) {
        user.setInviteCode(freshCode());
        users.save(user);
        return user.getInviteCode();
    }

    private String freshCode() {
        for (int i = 0; i < 8; i++) {
            String code = InviteCodes.generate();
            if (!users.existsByInviteCode(code)) return code;
        }
        throw new IllegalStateException("could not allocate a unique invite code");
    }

    @Transactional
    public void block(String blocker, String blocked) {
        if (blocker.equals(blocked) || blocks.existsByBlockerAndBlocked(blocker, blocked)) return;
        blocks.save(new UserBlock(blocker, blocked));
        // Drop any pending request from them so it doesn't linger in my inbox.
        friends.findByFromUserAndToUser(blocked, blocker)
                .filter(r -> r.getStatus() == FriendRequest.Status.PENDING)
                .ifPresent(r -> { r.setStatus(FriendRequest.Status.REJECTED); friends.save(r); });
    }

    @Transactional
    public boolean unblock(String blocker, String blocked) {
        return blocks.deleteBlock(blocker, blocked) > 0;
    }

    public List<String> blockedBy(String blocker) {
        return blocks.findByBlockerOrderByCreatedAtDesc(blocker).stream().map(UserBlock::getBlocked).toList();
    }
}

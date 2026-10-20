package com.iris.backend;

public record UserProfileDto(String username, String preferredName, String avatarUrl, String shareId) {
    public static UserProfileDto from(User user) {
        return new UserProfileDto(user.getUsername(), user.getPreferredName(), user.getAvatarUrl(), user.getShareId());
    }

    /** What a non-friend sees of a private profile: the username, nothing else. */
    public static UserProfileDto redacted(User user) {
        return new UserProfileDto(user.getUsername(), null, null, null);
    }
}

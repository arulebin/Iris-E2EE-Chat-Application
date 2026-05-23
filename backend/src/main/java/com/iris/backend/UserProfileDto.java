package com.iris.backend;

public record UserProfileDto(String username, String preferredName, String avatarUrl) {
    public static UserProfileDto from(User user) {
        return new UserProfileDto(user.getUsername(), user.getPreferredName(), user.getAvatarUrl());
    }
}

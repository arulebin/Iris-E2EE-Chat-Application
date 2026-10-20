package com.iris.backend;

// refreshToken is null-safe for old clients: they read `token` and ignore the rest.
public record LoginResponse(String token, String refreshToken) {
}

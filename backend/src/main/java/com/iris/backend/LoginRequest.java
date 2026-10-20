package com.iris.backend;

// v2 clients send `authKey` (client-derived, never the password).
// `password` is accepted only for v1 accounts that haven't upgraded yet.
public record LoginRequest(String username, String password, String authKey) {
    
}

package com.iris.backend;

// New accounts are always v2: the client derives `authKey` from the password with
// PBKDF2(authSalt) + HKDF, and the raw password never leaves the browser.
public record SignupRequest(String username, String authKey, String authSalt) {

}

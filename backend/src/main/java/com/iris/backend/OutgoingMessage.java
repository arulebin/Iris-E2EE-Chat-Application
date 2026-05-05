package com.iris.backend;
import java.time.Instant;
public record OutgoingMessage(String from, String to, String content, String encryptedKeyForSender, String encryptedKeyForRecipient, Instant sentAt) {}

package com.iris.backend;
import java.time.Instant;
public record OutgoingMessage(String from, String to, String content, Instant sentAt) {}

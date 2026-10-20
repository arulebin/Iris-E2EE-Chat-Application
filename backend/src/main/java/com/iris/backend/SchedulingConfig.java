package com.iris.backend;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

// Housekeeping jobs: refresh-session purge, WebSocket heartbeat sweep.
@Configuration
@EnableScheduling
public class SchedulingConfig {
}

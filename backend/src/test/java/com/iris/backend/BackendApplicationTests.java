package com.iris.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// A real embedded server: WebSocketConfig's ServletServerContainerFactoryBean needs
// the jakarta.websocket ServerContainer, which the default MOCK environment lacks.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BackendApplicationTests {

	@Test
	void contextLoads() {
	}

}

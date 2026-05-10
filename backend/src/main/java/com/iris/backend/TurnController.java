package com.iris.backend;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;

import java.util.Map;

@RestController
@RequestMapping("/api/turn")
public class TurnController {

    @Value("${cloudflare.turn.key-id:}")
    private String turnKeyId;

    @Value("${cloudflare.turn.api-token:}")
    private String turnApiToken;

    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping("/credentials")
    public ResponseEntity<?> getTurnCredentials() {
        if (turnKeyId == null || turnKeyId.isEmpty() || turnApiToken == null || turnApiToken.isEmpty()) {
            return ResponseEntity.status(500).body(Map.of("error", "Cloudflare TURN credentials not configured on the server"));
        }

        String url = "https://rtc.live.cloudflare.com/v1/turn/keys/" + turnKeyId + "/credentials/generate-ice-servers";

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(turnApiToken);
        headers.setContentType(MediaType.APPLICATION_JSON);

        // Request body asking for an 86400 TTL (1 day)
        String requestBody = "{\"ttl\": 86400}";
        HttpEntity<String> entity = new HttpEntity<>(requestBody, headers);

        try {
            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, entity, String.class);
            return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Failed to generate TURN credentials: " + e.getMessage()));
        }
    }
}

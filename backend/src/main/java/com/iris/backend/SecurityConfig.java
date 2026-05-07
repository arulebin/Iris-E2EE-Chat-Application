package com.iris.backend;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import jakarta.servlet.http.HttpServletResponse;
import java.util.List;

@Configuration
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    @Value("${cors.allowed-origins:http://localhost:5173,http://localhost:8080}")
    private String[] allowedOrigins;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter) {
        this.jwtAuthFilter = jwtAuthFilter;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        // Defaults cover Vite dev (5173) and the Docker frontend port (8080).
        // Override via cors.allowed-origins property or CORS_ALLOWED_ORIGINS env var (comma-separated).
        config.setAllowedOrigins(List.of(allowedOrigins));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of("Authorization"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // enable CORS — Spring Security picks up the CorsConfigurationSource bean automatically
            .cors(Customizer.withDefaults())

            // we're a stateless API → no CSRF tokens needed (CSRF protects forms with cookies)
            .csrf(csrf -> csrf.disable())

            // who can hit what
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/auth/**").permitAll()           // signup + login: open
                .requestMatchers("/error").permitAll()
                .requestMatchers("/h2-console/**").permitAll()     // dev DB browser: open
                .requestMatchers("/ws/**").permitAll()             // WebSocket — we'll lock down in 6.5 half B
                .anyRequest().authenticated()                      // everything else: must have a valid token
            )

            // no server-side session — every request reauthenticated by JWT
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

            // h2-console uses iframes — without this, X-Frame-Options blocks it
            .headers(h -> h.frameOptions(f -> f.sameOrigin()))

            .exceptionHandling(e -> e
            .authenticationEntryPoint((req, res, ex) -> {
                res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                res.setContentType("application/json");
                res.getWriter().write("{\"error\":\"Unauthorized\"}");
            })
            )

            // run our JWT filter BEFORE the username/password one
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}

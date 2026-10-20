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

    @Value("${spring.h2.console.enabled:false}")
    private boolean h2ConsoleEnabled;

    @Value("${cors.allowed-origins:http://localhost:5173,http://localhost:8080,https://iris-chat-web.vercel.app,https://localhost}")
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
        // Defaults cover Vite dev (5173), the Docker frontend port (8080), and the
        // Capacitor Android app, whose WebView origin is https://localhost.
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
            .authorizeHttpRequests(auth -> {
                auth.requestMatchers("/auth/**").permitAll()       // signup + login: open
                    .requestMatchers("/error").permitAll();
                // dev DB browser: only reachable when explicitly enabled (H2_CONSOLE_ENABLED=true)
                if (h2ConsoleEnabled) auth.requestMatchers("/h2-console/**").permitAll();
                // WebSocket: the token travels as ?token=, which the JWT filter doesn't read,
                // so JwtHandshakeInterceptor authenticates and rejects the upgrade instead.
                auth.requestMatchers("/ws/**").permitAll()
                    .anyRequest().authenticated();                 // everything else: must have a valid token
            })

            // no server-side session — every request reauthenticated by JWT
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

            // h2-console uses iframes, so relax X-Frame-Options only when it's enabled
            .headers(h -> h.frameOptions(f -> {
                if (h2ConsoleEnabled) f.sameOrigin(); else f.deny();
            }))

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

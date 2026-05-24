# Iris

A self-hosted, end-to-end-encrypted chat + voice/video Progressive Web App (PWA).  
Built natively with React, Vite, Spring Boot, and WebRTC.

## 🌟 Features

- **End-to-End Encryption (E2EE):** Hybrid encryption (RSA-OAEP + AES-GCM) ensures the server only ever sees ciphertext. Keys are securely stored and synced across devices using an encrypted backup.
- **Real-Time Messaging:** Instant messaging powered by WebSockets.
- **Voice & Video Calls:** 1-to-1 WebRTC peer connections with signaling routed through the backend.
- **Web Push Notifications:** Real-time push notifications using VAPID and Service Workers when you are offline.
- **Progressive Web App (PWA):** Installable on desktop and mobile, acting as a native app with offline caching strategies.
- **Privacy First:** 1-to-1 messaging model where you only see users you've chatted with or who share an invite link. No federation.
- **Profile Customization:** Upload avatars, set preferred names, and share your profile via QR Codes or invite links.

## 🏗️ Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│  Browser (PWA, served by Vite at :5173)                       │
│  ├─ React UI (Tailwind CSS v4)                                │
│  ├─ Web Crypto API (RSA-OAEP keypair + AES-GCM)               │
│  ├─ IndexedDB (private key per username)                      │
│  ├─ Service Worker (offline cache + push handler)             │
│  ├─ WebSocket client (bearer token in URL query)              │
│  └─ WebRTC peer connection (signaling via WebSocket)          │
└───────────────────────────────────────────────────────────────┘
                          ║  WSS + HTTPS (CORS-enabled)
┌───────────────────────────────────────────────────────────────┐
│  Spring Boot 4 backend (:8080)                                │
│  ├─ /auth/signup, /auth/login → BCrypt + JWT                  │
│  ├─ /api/users — list other users                             │
│  ├─ /api/messages?with=X — per-conversation history           │
│  ├─ /api/keys, /api/keys/{user} — public-key directory        │
│  ├─ /api/push/{vapid-public-key, subscribe} — push setup      │
│  ├─ /ws/chat — WebSocket (chat + WebRTC signaling)            │
│  └─ Sends Web Push when recipient is offline                  │
└───────────────────────────────────────────────────────────────┘
```

## 🛠️ Tech Stack

**Frontend:**
- Vite 5+
- React 18 + TypeScript
- Tailwind CSS v4
- IndexedDB (`idb-keyval`)
- Native APIs: Web Crypto, WebSocket, WebRTC, Service Worker, Push API

**Backend:**
- Java 25 (built on JDK 26)
- Spring Boot 4.0.6
- Maven
- H2 Database (File mode)
- Spring Data JPA (Hibernate 7)
- Spring Security 7 + JJWT (JSON Web Token)
- BouncyCastle & web-push for Web Push Notifications

## 🚦 Prerequisites

To run this project locally, ensure you have the following installed:
- **Node.js**: v24+
- **Java**: JDK 26
- **Docker**: For running via Docker Compose (optional)

## 🚀 Getting Started

### Option 1: Docker Compose (Recommended)

1. Boot up both the frontend and backend using Docker Compose:
   ```bash
   docker-compose up --build
   ```
2. Open your browser and navigate to `http://localhost:8082`

### Option 2: Run Locally (Development)

**Backend:**
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Build and run via Maven Wrapper:
   ```bash
   ./mvnw spring-boot:run
   ```
   *The backend will be available at `http://localhost:8081`.*

**Frontend:**
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   *The frontend will be available at `http://localhost:5173`.*

## 🌍 Deploying to Production (Server / Cloudflare)

Running `docker-compose up` alone is **not enough** for a production server. Because this app relies on the Web Crypto API, MediaDevices (Camera/Mic), and Service Workers, it **strictly requires HTTPS**. Furthermore, WebRTC (voice/video) requires a TURN server to connect users across different networks and firewalls.

### 1. Configure Cloudflare DNS (for HTTPS)
Point your domain's DNS A/AAAA record to your server's IP in the Cloudflare Dashboard and ensure it is **Proxied (Orange Cloud)**. Cloudflare will automatically provide the required SSL/TLS certificate to the browser.
*Note: Your `docker-compose.yaml` routes the frontend to port 8082, so you'll likely need a reverse proxy like Nginx or a Cloudflare Tunnel on your server to forward traffic from `80`/`443` to `8082`, unless you modify the docker compose to map `80:80` directly.*

### 2. Configure a TURN Server (Cloudflare Calls)
Without a STUN/TURN server, voice/video calls will only work if both users are on the same WiFi. 
1. Log into Cloudflare.
2. Go to **Calls** (or WebRTC).
3. Generate STUN/TURN credentials. You will get a Key ID and an API Token.

### 3. Setup Environment Variables (`.env`)
Create a `.env` file in the root of the project next to `docker-compose.yaml`. Docker Compose will automatically read these variables.

```env
# General Security
JWT_SECRET=your_super_secret_jwt_string_needs_to_be_long
MEDIA_MASTER_KEY=your_super_secret_media_key_for_images

# Web Push Notifications
# Run `npx web-push generate-vapid-keys` to get these
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@your-domain.com

# WebRTC Video/Audio (from Cloudflare dashboard)
CLOUDFLARE_TURN_KEY_ID=...
CLOUDFLARE_TURN_API_TOKEN=...

# CORS (Your actual production URL)
CORS_ALLOWED_ORIGINS=https://chat.your-domain.com
```

### 4. Run Docker
Once your `.env` file is populated:
```bash
docker-compose up -d --build
```

## 🔒 Security Model
Iris employs End-to-End Encryption where messages are encrypted using an ephemeral AES key. That AES key is then dual-encrypted using the sender's and recipient's RSA public keys. 
When logging in from a new device, a Key Encryption Key (KEK) is derived from your password to decrypt your centrally-backed-up private key securely.

---
*Created as an exploratory self-hosted learning project.*

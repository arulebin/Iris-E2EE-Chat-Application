# Iris mobile architecture (React Native + shared core)

Status: foundation phase. Decision: the Android/iOS app is a native React Native
(Expo, dev client) app. The web app stays React/Vite. Both share a TypeScript core.
The existing Capacitor Android wrapper (`com.iris.chat`) stays as-is until the
native app reaches parity; the new app is `com.iris.chat.mobile` so both install side by side.

## 1. Monorepo layout

npm workspaces at the repo root:

```
package.json                 workspaces: packages/*, mobile   (frontend joins in phase 2)
packages/
  core/                      @iris/core: platform-neutral TS (no DOM, no Node, no RN imports)
  crypto-conformance/        @iris/crypto-conformance: known-answer tests for CryptoProvider
frontend/                    React + Vite web app (+ Capacitor shell), unchanged today
mobile/                      Expo / React Native app (expo-router, dev client)
backend/                     Spring Boot, unchanged
docs/
```

Why `frontend/` is not a workspace yet: it pins React 19.2 / Vite 8 while RN 0.88 needs
React 19.3.0 exactly. Hoisting both into one root `node_modules` is the classic source of
duplicate-React and Metro resolution bugs. Phase 2 moves the web app in once core is big
enough to justify it, with `react` resolved per workspace (nohoist or overrides) and a
CI check that each app bundles a single copy of React.

Source-level consumption: `@iris/core` is consumed as TypeScript source (`main: src/index.ts`).
Vite and Metro both transpile workspace TS, so there is no build step for core. Imports
inside core use explicit `.ts` extensions (`allowImportingTsExtensions`), which both bundlers
and Node/vitest accept.

Rules for core: no `window`, `document`, `indexedDB`, `localStorage`, `Buffer`, global
`crypto`, `fetch` assumptions beyond the standard `fetch`, no React. Anything platform-specific
comes in through an interface (section 3).

## 2. What moves into `@iris/core`

| Today (frontend/src) | Core module | Platform seam |
| --- | --- | --- |
| `lib/config.ts`, API calls spread over `crypto.ts`, `lib/signal/api.ts`, `lib/auth.ts` | `api/` client: typed endpoints over a `Transport`, plus `createAuthedFetch` (bearer token, single-flight refresh on 401, retry once, sign-out on failure; already in `transport.ts`) | `Transport`, `TokenStore` |
| `lib/signal/*` (client, device, messaging, store, kv) | `signal/`: device provisioning, prekey rotation, session build/encrypt/decrypt, store | `KV`, `KeyWrapper`, `CryptoProvider` (via `setWebCrypto`) |
| `crypto.ts`, `lib/credentials.ts` | `crypto/`: PBKDF2 then HKDF credential split, KEK wrap/unwrap, legacy RSA envelope, PSS cross-signature | `CryptoProvider` (byte level, no `CryptoKey` handles) |
| `lib/fingerprint.ts` | `safetyNumber.ts` (done, proof module), pin/TOFU logic | `CryptoProvider`, `KV` |
| `lib/messageStore.ts`, `lib/backup.ts`, `lib/atRest.ts` | `store/`: encrypted message store, backup envelope, at-rest cipher | `KV`, `KeyWrapper`, optional gzip |
| `lib/media.ts`, `profileImage.ts` | `media/`: per-attachment AES-GCM key and envelope (bytes in, bytes out) | `CryptoProvider`; image decode/resize stays in the platform |
| types scattered in components | `types/`: DTOs shared with the backend contract | none |

Stays platform-side (never in core): React components, routing, camera/media picker, push,
WebRTC, sounds, theming, screen-security flags, biometrics, file pickers, share sheets.

Already in core (this change): `CryptoProvider`, `createSubtleProvider`, `KV`, `MemoryKV`,
`KeyWrapper`, `Transport`, `TokenStore`, `createAuthedFetch`, base64/hex helpers,
`createLibsignalWebCrypto`, and `safetyNumber.ts` (copied from `frontend/src/lib/fingerprint.ts`,
with tests that compare against libsignal's own `FingerprintGenerator`).

### Provider shape

`CryptoProvider` is byte-in/byte-out (digest, hmac, hkdf, pbkdf2, AES-GCM, AES-CBC, RSA-OAEP,
RSA-PSS, randomBytes, optional gzip). Reasons: (a) an adapter can mix backends per operation
(native for PBKDF2, noble for a gap) without touching call sites; (b) RN has no structured
clone of `CryptoKey`, so persistence of key material is deliberately a `KeyWrapper` concern;
(c) one conformance suite can validate any backend, on Node or on a device.

## 3. Platform adapters

| Concern | Web (`frontend/`) | Mobile (`mobile/`) |
| --- | --- | --- |
| Crypto backend | WebCrypto via `createSubtleProvider(crypto.subtle)` | `react-native-quick-crypto` subtle via `createSubtleProvider`, gaps from `@iris/crypto-conformance/pure-js` |
| KV storage | IndexedDB (`idb-keyval`) | `react-native-mmkv` (v4, Nitro) for small state; `expo-sqlite` if the message store needs queries |
| KeyWrapper | AES-GCM `CryptoKey`, non-extractable, stored in IndexedDB (structured clone) | Android Keystore / iOS Keychain. Candidates: `expo-secure-store` (AES key in Keystore, simplest), later a StrongBox/biometric-gated key via a small native module |
| HTTP | `fetch` | `fetch` (RN) |
| Realtime | browser `WebSocket` | RN `WebSocket` plus AppState-aware reconnect, token in first frame (RN cannot set WS headers reliably on all platforms) |
| Camera / picker | `getUserMedia`, `<input type=file>` | `expo-camera`, `expo-image-picker` |
| Push | Web Push (+ FCM through Capacitor today) | `expo-notifications` with FCM (Android) / APNs (iOS); payloads stay generic, content is fetched and decrypted on device |
| Calls | browser WebRTC | `react-native-webrtc` + CallKeep (iOS) / ConnectionService (Android) for the native incoming-call UI |
| Biometrics | WebAuthn | `expo-local-authentication`; gate `KeyWrapper.unwrap` |
| Compression | `CompressionStream` | `fflate` (Hermes has none) |
| Animations | CSS | `react-native-reanimated` 4 + `react-native-gesture-handler` |

## 4. Crypto feasibility on React Native

This was the main risk, so it was checked against source, not documentation.

Package under test: `react-native-quick-crypto@1.1.8` (npm latest at time of writing; pinned exactly).
Method: read `src/subtle.ts` (dispatch tables for each `Subtle` method), `src/pbkdf2.ts`,
`src/hkdf.ts`, and the C++ under `cpp/`. All algorithms run in native code (OpenSSL through
Nitro Modules); PBKDF2 and HKDF run on a native thread (`Promise::async`) and do not block the JS thread.

### Support matrix (what Iris calls)

| Operation (Iris usage) | quick-crypto 1.1.8 | Evidence | Verdict |
| --- | --- | --- | --- |
| `digest` SHA-256 / SHA-512 (fingerprints, safety numbers: 2 x 5200 SHA-512 rounds) | yes | `asyncDigest` in `hash.ts` | supported; per-call bridge cost needs on-device timing |
| HMAC SHA-256 import + sign (libsignal MAC/HKDF) | yes | `hmacImportKey`, `signVerify` case `HMAC` | supported |
| HKDF-SHA-256 `deriveBits` / `deriveKey` (auth key, KEK, backup keys) | yes | `Subtle.deriveBits/deriveKey` case `HKDF`, `hkdf.ts` native `deriveKeySync` | supported (note: `deriveKey` path calls the sync native HKDF; fine for 32 bytes) |
| PBKDF2-HMAC-SHA-256, 600,000 iterations | yes, native, async thread | `pbkdf2DeriveBits` to `HybridPbkdf2` (`Promise::async`) | supported; speed to be confirmed on device (Node/OpenSSL: about 80 ms) |
| AES-256-GCM with `additionalData`, tag 128 | yes | `aesCipher` / `validateTagLength`, `setAAD` | supported |
| AES-CBC (libsignal) | yes | `cipherOrWrap` case `AES-CBC` | supported |
| RSA-OAEP-2048 SHA-256 encrypt/decrypt, JWK import | yes | `rsaCipher` (`RsaCipher` hybrid), `importKey` RSA `jwk` branch | supported (legacy only) |
| RSA-PSS-SHA-256 sign/verify with `saltLength` | yes | `signVerify` case `RSA-PSS` (`rsaSignVerify(..., 'pss', saltLength)`) | supported (legacy only) |
| RSA-OAEP `generateKey` 2048 | yes | `rsa_generateKeyPair` | supported (only needed by the legacy v1 path) |
| `getRandomValues` | yes | `random.ts` | supported |
| Non-extractable `CryptoKey` persisted to disk | no (no structured clone; keys are JSI objects) | architectural | replace with `KeyWrapper` (Keystore) |
| `crypto.subtle` as a global | opt-in via `install()` | `index.ts` | we do NOT patch globals; pass the provider explicitly, and give libsignal a shim (`createLibsignalWebCrypto`) |
| `CompressionStream` / `DecompressionStream` | not provided; Hermes has none | n/a | `fflate` gzip |
| XEdDSA / curve25519 signatures used by libsignal | no (has X25519 and Ed25519, but not Signal's XEdDSA variant) | `ed.ts` | keep libsignal's bundled curve25519 asm.js (proven to run without WebAssembly, see below); optional later: XEdDSA on `@noble/curves` |

Beyond the minimum, the library also implements ECDSA/ECDH, Ed25519/X25519, ML-KEM/ML-DSA,
Argon2, ChaCha20-Poly1305 and more, which opens a future path to Argon2id instead of PBKDF2.

### Gaps and mitigations

1. **Hermes lacks `CompressionStream`.** Backups use gzip when available and fall back to
   uncompressed. Mitigation: `fflate` (0.8.3), cross-checked against zlib output in the suite.
   Note: web and mobile must agree on a backup format flag so a mobile gzip backup opens on web
   (browsers can decompress) and vice versa.
2. **Libsignal's WebCrypto is injected, not global.** `setWebCrypto(createLibsignalWebCrypto(provider))`.
   Tested end to end in Node (X3DH + double ratchet round trip on the pure-JS provider).
3. **Curve25519 in libsignal is Emscripten output with a WebAssembly path and an asm.js path.**
   Hermes has no WebAssembly. Verified under Node with `WebAssembly` deleted: key generation and
   signed prekey signing work (about 70 ms). Hermes performance of 860 KB of asm.js is unmeasured;
   it is a day-one on-device benchmark (acceptance in phase 1). Fallback: XEdDSA on `@noble/curves`.
   Caution: the Emscripten loader probes `process.versions`; do not polyfill `process.versions.node`
   (quick-crypto sets `global.process = {}` only if absent, which is safe).
4. **Pure-JS fallbacks are slow on Hermes.** On Node (V8 JIT) PBKDF2-SHA256 at 600k takes about
   80 ms native vs about 480 ms in `@noble/hashes`. Hermes has no JIT, so expect another order of
   magnitude (estimate: 10 to 40 s), unusable for login. So the native backend is REQUIRED for
   PBKDF2; the pure-JS provider is for gaps and as a test oracle, not as the primary path.
5. **RSA only on legacy paths.** If a quick-crypto RSA op ever fails the suite on some device,
   `node-forge` (1.4.0) implements OAEP and PSS with SHA-256/MGF1-SHA-256 (verified against OpenSSL
   vectors in the suite). Keygen in forge is very slow; never generate RSA keys on-device in JS.
6. **No persistent `CryptoKey`.** Raw key bytes live only in memory, wrapped at rest by Keystore.
   This is stronger than the web model in one respect (hardware-backed) and weaker in another
   (key material is in JS heap while the app is unlocked). Document in the threat model.

### Conformance suite

`packages/crypto-conformance` runs 20 known-answer cases (NIST/RFC vectors, OpenSSL-generated RSA
vectors, and Iris's exact login derivation `PBKDF2 600k then HKDF "iris-auth-v2"`) through the
`CryptoProvider` interface:

- Node: reference provider (WebCrypto), and the pure-JS provider. Both pass all cases (45 tests including benchmarks and runner checks)
  (`npm test -w packages/crypto-conformance`), plus a libsignal round trip and a no-WebAssembly check.
- Device: the mobile Diagnostics screen (`mobile/app/diagnostics.tsx`) runs the same `runConformance`
  against `react-native-quick-crypto` and prints per-case timings. Running it on a device and
  recording the 600k PBKDF2 time is the phase 1 gate.

## 5. Phased migration plan

Each phase ends with a shippable, reviewable state and explicit acceptance criteria.

**Phase 0: Foundation (this change)**
- Workspaces, `@iris/core` skeleton, conformance suite, Expo dev-client scaffold that builds.
- Accept: `npm test` green in core and conformance; `tsc` green in mobile; `./gradlew assembleDebug`
  produces an APK with `com.iris.chat.mobile`; web app untouched.

**Phase 1: Crypto on device (de-risk)**
- Run the conformance suite on a physical Android device (and one low-end device).
- Measure: PBKDF2 600k, 5200-round safety number, libsignal identity + prekey generation, session
  encrypt/decrypt, AES-GCM on a 10 MB attachment.
- Accept: all critical cases pass on-device; login key derivation under 1.5 s on a mid-range phone;
  safety number under 2 s; libsignal curve ops under 300 ms each, otherwise implement XEdDSA on noble.

**Phase 2: Move shared logic into core (web keeps working)**
- Move, one module at a time with the web app re-importing from `@iris/core`: crypto helpers,
  `fingerprint`, Signal client/store (behind `KV`/`KeyWrapper`), API client with `createAuthedFetch`,
  media and backup envelopes, types. Add `frontend` to workspaces with React resolution checks.
- Accept: existing frontend tests pass unchanged against core imports; no behavior change in the web
  app (manual smoke: register, login, send/receive, safety number, backup restore); core has no DOM
  or Node imports (lint rule).

**Phase 3: Mobile auth, storage and messaging (text)**
- Adapters: MMKV KV, Keystore KeyWrapper, RN transport with reconnect. Screens: auth, unlock, chat
  list, conversation (text), friends, safety number.
- Accept: account created on web can sign in on mobile and exchange messages both ways; keys survive
  app restart and process death; a second device converges on the same identity as today.

**Phase 4: Push, background, presence**
- `expo-notifications` (FCM), generic push text, fetch-and-decrypt on tap, read receipts, typing,
  online status, unread badges.
- Accept: message arrives with the app killed; notification contains no plaintext; tapping opens the
  right chat; background reconnect within 5 s of foregrounding.

**Phase 5: Media, camera, snaps**
- Camera capture, picker, encrypted attachments, snap viewer with view-once and screen-security flags.
- Accept: 10 MB photo round trip mobile to web and back; snap deletes after view; screenshots blocked
  where the OS allows.

**Phase 6: Calls**
- `react-native-webrtc`, signaling reuse, CallKeep / ConnectionService, foreground service.
- Accept: audio call mobile to web with screen locked and app backgrounded; native incoming-call UI.

**Phase 7: Hardening and release**
- Biometric-gated keys, backup restore on mobile, app signing, Play internal track, crash reporting
  without content, performance pass (list virtualization, Hermes profile), deprecate the Capacitor shell.
- Accept: security checklist passes, release build under size budget, a full cross-platform
  regression run.

## 6. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hermes performance of libsignal asm.js curve25519 | Slow session setup | On-device benchmark in phase 1; XEdDSA on noble as fallback |
| quick-crypto is a young, fast-moving native library (Nitro) | Breakage on RN upgrades | Exact pins; conformance suite on every upgrade; provider interface lets us swap the backend |
| Expo SDK 58 / RN 0.88 are very new (new architecture only) | Library incompatibilities | Pin; use `expo install --check`; avoid unmaintained native modules |
| Web and mobile format drift (backups, envelopes) | Data not portable | Single implementation in core, shared test vectors |
| Key material in JS heap on mobile | Weaker than web non-extractable keys | Short-lived unwrap, zeroize buffers, Keystore wrapping, biometric gate |
| Two Android apps share a backend and push project | Token/registration confusion | Distinct package id and FCM app registration per app |
| Monorepo hoisting (React 19.2 vs 19.3) | Duplicate React, Metro errors | Keep frontend out until phase 2; per-workspace React resolution |
| Windows path length / Gradle on JDK 26 | Build failures | Use Android Studio JBR (JDK 21); build from a short path in CI |

## 7. Status

### Android build (Phase 0, done)

`./gradlew assembleDebug` in `mobile/android` produces `app-debug.apk` (package `com.iris.chat.mobile`, arm64-v8a only for dev,
about 105 MB) and installs next to the Capacitor app. Windows notes:

- Use Android Studio's JBR (JDK 21) as `JAVA_HOME`; `local.properties` (gitignored) holds `sdk.dir`.
- CMake object paths for react-native-gesture-handler, screens, worklets and nitro exceed 260 characters even from a short
  checkout (the relative path alone is about 274), and CMake 3.22.1's bundled ninja 1.10.2 refuses them
  ("Filename longer than 260 characters"). With the OS setting LongPathsEnabled=1, replacing ninja by 1.13.2 fixes it:
  copy `Sdk/cmake/3.22.1` to a private dir, drop a newer `ninja.exe` into its `bin`, and set `cmake.dir=` in `local.properties`.
  No short-path copy or `subst` is needed (`subst` breaks the codegen, which mixes `X:` and realpath `D:` roots).
- `org.gradle.configuration-cache=false` in `mobile/android/gradle.properties`: the Expo/RN gradle scripts spawn `node`
  during configuration, which fails the build under the configuration cache.
- `mobile/vitest.config.mts` and the `.json` suffix in `tsconfig.json`'s `extends` exist because Vite cannot resolve `expo/tsconfig.base`.

### Phase 1 gate: on-device results (Redmi Note 7 Pro, Snapdragon 675, Android 16, Hermes, dev bundle)

Run with `iris://bench?autorun=1` (screen `mobile/app/bench.tsx`, code `mobile/src/platform/bench.ts`; rows are logged to logcat
as `IRIS_BENCH {json}`). Single warm runs; the Metro dev bundle is slower than a release build.

| Measurement | Result | Gate | |
| --- | --- | --- | --- |
| Login derivation: PBKDF2-SHA256 600k + HKDF `iris-auth-v2` (native) | 154 to 193 ms | < 1500 ms | pass |
| Safety number (2 x 5200 SHA-512 rounds, native digest per round) | 740 to 790 ms | < 2000 ms | pass |
| AES-GCM 1 KiB enc+dec x50 | 23 to 28 ms | | |
| AES-GCM 10 MiB encrypt / decrypt | 17 ms / 25 to 43 ms | | |
| HKDF x50 / HMAC 1 KiB x50 | 6 ms / 13 ms | | |
| libsignal asm.js: generateKeyPair | 264 to 272 ms | < 300 ms | pass (barely) |
| libsignal asm.js: XEdDSA sign | 368 to 377 ms | < 300 ms | FAIL |
| libsignal asm.js: XEdDSA verify | 256 to 262 ms | < 300 ms | pass (barely) |
| libsignal asm.js: X25519 agree | 268 to 273 ms | < 300 ms | pass (barely) |
| asm.js: 2 identities + signed prekey + prekey | 1.9 s | | too slow |
| asm.js: X3DH processPreKey / full X3DH + ratchet roundtrip | 2.2 s / 2.8 s | | too slow |
| asm.js: ratchet steady state, 10 messages enc+dec | 0.86 s | | |
| **noble:** generateKeyPair / sign / verify / agree | 9 / 21 / 58 / 40 ms | < 300 ms | pass |
| **noble:** 2 identities + prekeys / processPreKey / roundtrip | 88 / 264 / 339 ms | | |
| **noble:** ratchet steady state, 10 messages | 132 ms | | |

Verdict: native PBKDF2 is about 8x under the gate (the pure-JS estimate of 10 to 40 s is irrelevant). libsignal's asm.js
curve fails the sign gate and makes first-message session setup take seconds, so the fallback is implemented and is the default.

### Fallback implemented: XEdDSA/X25519 on `@noble/curves`

`packages/core/src/crypto/nobleCurve.ts` (`createNobleAsyncCurve`), injected with libsignal's `setCurve` by
`mobile/src/platform/libsignal.ts` (`installLibsignal(provider)`, which also does `setWebCrypto`). It reproduces libsignal-protocol-c's
`curve25519_sign/verify` including the sign bit stored in `sig[63]` and the inverted `verify` result.
`nobleCurve.test.ts` cross-checks 20 key pairs, agreements and 60 signatures both ways against the asm.js build, both sign-bit values,
plus tamper cases. Result on device: 13 to 18x faster per op, session setup 0.26 s instead of 2.2 s.

### Platform adapters (`mobile/src/platform`, native modules in `mobile/modules`)

| Adapter | Implementation | Verified |
| --- | --- | --- |
| `KeyWrapper` | `iris-keystore` Expo module (Kotlin): AES-256-GCM in AndroidKeyStore, StrongBox with TEE fallback, per-alias, `wrap/unwrap/reset`, `KEY_MISSING` | on device: roundtrip (60 B blob, level `tee`: the Redmi has no StrongBox), reset gives `KeystoreKeyMissingError` |
| App-lock key | same module: auth-bound key (strong biometric or screen lock, timeout window, invalidated by enrollment), `BiometricPrompt` via androidx.biometric; errors `AUTH_REQUIRED`, `KEY_INVALIDATED`, `CANCELED`, `LOCKOUT`; `layerWrappers` stacks it over the Keystore wrapper | compiled; creating the key fails on this phone because no secure lock screen is set (expected); lock UI is later |
| `KV` | `MmkvKV` over react-native-mmkv; `openEncryptedKV` generates a 16 char MMKV key (MMKV's AES key is at most 16 bytes) stored only wrapped by the KeyWrapper in a small boot instance | on device: persists and reopens |
| `TokenStore` | access + refresh tokens stored only as Keystore-wrapped blobs; lost key means signed out | on device: no plaintext in storage |
| `Transport` | core `createAuthedFetch` (refresh semantics of `frontend/src/lib/api.ts`: single flight, proactive refresh under 60 s, 409 retry, only a definitive 401 from `/auth/refresh` signs out) and core `createRealtime` (25 s ping, 10 s pong timeout once the server has answered, backoff 1 to 30 s, forced token refresh after 2 failed handshakes, wake on foreground / network back) wired to `AppState` and NetInfo | unit tests (fake sockets, fake timers); not yet against the live socket |
| FLAG_SECURE | `iris-screen-security` module, on by default (reapplied whenever the activity enters the foreground), `setScreenSecure(false)` to toggle. Note: it also blocks `adb screencap` | on device: default on |
| Push | expo-notifications; `createPush` creates channels `messages`/`calls`, registers the raw FCM token with `POST /api/push/fcm-token`, `DELETE` on logout, re-registers on rotation. Firebase app `com.iris.chat.mobile` (id `1:156258039756:android:879b74afe431d424a20f69`) added to project iris-chat-404d; `mobile/google-services.json` is gitignored | on device: FCM token obtained; registration with the backend needs a login and was not exercised |

Tests: `npm test -w @iris/core` (28), `npm test -w @iris/crypto-conformance` (45), `npm test -w @iris/mobile` (14); `tsc --noEmit` is clean in all three.

### Open items

- Phase 2/3: wire `createPlatform()` (in `platform/index.ts`) into the auth flow; at-rest AES-GCM layer for the Signal store on top of encrypted MMKV.
- Push: expo-notifications ships its own `FirebaseMessagingService`; data-only call pushes (`IrisCallPush.handle`, see the calls branch) need a service that delegates to it.
- Re-run the benchmark on a release build and on a low-end device; the numbers above are dev-bundle.
- `frontend/` joins the workspaces in phase 2.

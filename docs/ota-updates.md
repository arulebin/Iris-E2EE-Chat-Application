# Signed, self-hosted OTA updates (mobile)

Iris Mobile can receive JavaScript/asset updates without a new APK, from a tiny update
server you host yourself. Because an OTA update replaces the code that handles your keys,
**every update is code-signed offline and the app refuses anything that does not verify**.

## Architecture

```
developer machine (OFFLINE private key)            VM (Caddy -> updates:8081)          phone
  expo export -> manifest -> RSA-SHA256 sign  -scp->  static files (no key, read-only) -> expo-updates
  scripts/ota-publish.mjs                              updates-server/server.mjs           verifies signature
                                                                                           against the cert
                                                                                           embedded in the APK
```

- `scripts/ota-publish.mjs` exports the bundle, builds a protocol-v1 manifest (asset
  hashes, absolute asset URLs), signs the exact manifest bytes, self-verifies the
  signature against `mobile/certs/certificate.pem`, and uploads files over ssh/scp
  (assets first, release, then flips `current.json` last so clients never see a
  half-uploaded release).
- `updates-server/server.mjs` (dependency-free Node, ~150 lines, tests in
  `updates-server/test`) implements the Expo Updates protocol v1: `GET /manifest`
  (multipart, routed by `expo-platform` / `expo-runtime-version` / `expo-channel-name`),
  `GET /assets/<sha256>.<ext>`, `GET /native.json`, `GET /healthz`. The signature header
  is passed through verbatim from the uploaded `signature.txt`. It reads a read-only data
  dir and holds no key.
- Caddy routes `https://<host>/updates/*` to the `updates` compose service (profile
  `updates`, `mem_limit: 48m`, read-only FS, non-root, no capabilities). It is **not
  started by default** and **not deployed** by `deploy.sh`.
- The app (`mobile/src/updates`) uses `expo-updates` plus a small hook layer.

### Server data layout (`~/iris/updates-data/`)

```
channels/<channel>/<runtimeVersion>/<platform>/current.json   {"kind":"manifest"|"directive","id":"<uuid>"}
releases/<id>/body.json        exact signed bytes (manifest, or rollback directive)
releases/<id>/signature.txt    expo-signature header value: sig="...", keyid="main", alg="rsa-v1_5-sha256"
assets/<base64url sha256>      content-addressed assets (immutable caching)
native.json                    optional, binary-update hint (below)
```

## Threat model

| Attacker | Can they run code on users' phones? |
|---|---|
| Network attacker (MITM) | No: TLS, and the manifest is signed anyway. |
| Compromised VM / update server / Caddy / CDN | **No.** The server only has signed artifacts; it cannot sign new ones. It can: withhold updates (users stay on the current version), serve an older still-signed manifest (the client only adopts updates newer than the one it runs, so this is ignored in practice), or take the service down (the app keeps working from the embedded/last good bundle). |
| Tampered asset on the server | No: the signed manifest carries every asset's SHA-256, which the client verifies. |
| Thief of the **private key** | **Yes.** This is the crown jewel; see key handling. |
| Someone editing `native.json` | Can only cause a prompt. The app never installs anything and only opens `github.com/<owner>/<repo>/releases...` (APK) or the Play listing; other URLs are dropped. |
| Developer ships a bad update | Mitigated by staging channel first, automatic rollback on launch crash, and the rollback directive. |

Out of scope: a malicious dev with the private key, a compromised developer machine, or
a malicious binary (the cert is embedded at build time, so build integrity matters).

## Key handling

- Generate the **real** keypair once, on your own machine, outside the repo:

  ```bash
  cd mobile
  npx expo-updates codesigning:generate \
    --key-output-directory ~/.iris-ota \
    --certificate-output-directory certs \
    --certificate-validity-duration-years 10 \
    --certificate-common-name "Iris OTA"
  ```
  (The certificate output directory must be empty: delete the committed DEV
  `mobile/certs/certificate.pem` first.) Then commit **only** `mobile/certs/certificate.pem`.
- `~/.iris-ota/private-key.pem` is the default signing key location
  (`--key` or `IRIS_OTA_PRIVATE_KEY` override). Back it up offline (encrypted USB / password
  manager). **Never** put it in the repo, on the VM, in CI logs, or in chat.
  `.gitignore` blocks `.ota-dev/`, `.ota-keys/`, `**/private-key.pem`, `*.private.pem`,
  `*-private-key.pem`, `ota-out/`.
- The repo currently ships a **DEV certificate** (`CN=Iris OTA DEV (replace before
  release)`) whose private key exists only in the gitignored `mobile/.ota-dev/` of the machine
  that generated it. It exists so `app.json` is valid and local testing works. The publish
  script warns when signing with a DEV cert. **Replace it before any real release build.**
- The script refuses to sign if the private key does not match the embedded certificate or
  the certificate expired.
- `codeSigningMetadata.keyid` is `main`; keep it in sync with the signature header.

### Rotating keys

The certificate is baked into each binary, so rotation requires a new APK:

1. Generate a new keypair/certificate (as above, new key directory).
2. Replace `mobile/certs/certificate.pem`, build and distribute a new APK (the runtime
   version fingerprint changes automatically because the app config changed). Bump
   `android.versionCode`.
3. Publish updates for the new runtime version signed with the new key. Old binaries keep
   trusting the old key and keep receiving updates for *their* runtime version only if you
   still sign those with the old key; once everyone has moved, destroy the old key.
4. If the old key is **compromised**: stop serving updates for old runtime versions
   (delete their `channels/*/<rv>` dirs), publish `native` info with `minVersionCode` = the
   new versionCode so old binaries are prompted to install the new APK.
5. Expiry: renew before the certificate's `notAfter` the same way (new APK required).

## App behaviour

- **Runtime version policy: `fingerprint`.** The runtime version is a hash of everything
  native (native modules, plugins, app.json native config, expo-updates config). Any native
  change produces a new runtime version automatically, so JS can never land on an
  incompatible binary and no one has to remember to bump a number. The cost: harmless
  config edits can also change it (you just publish for the new value). `appVersion` was
  rejected: it relies on humans bumping the version on every native change. The publish
  script resolves it with `npx expo-updates runtimeversion:resolve`, so build and publish
  must run on the same checkout state (same deps, same `app.json`).
- **Check on launch** (`checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`): the
  app starts immediately from the cached bundle, downloads in the background, and runs the
  new bundle on the **next cold start**. **On resume** `useOtaUpdates` re-checks, throttled
  to once per 6 h. When a bundle is downloaded the `UpdateBanner` offers "Restart to
  update" (optional; ignoring it is fine).
- **Automatic rollback:** `expo-updates` error recovery is built in and always on: if a
  downloaded bundle throws on startup, the native layer marks it failed and relaunches
  the previous good bundle (ultimately the embedded one), and will not select the failed
  update again. There is no config switch. Settings -> About shows "Recovery" when the app
  is running from such a fallback (`isEmergencyLaunch`).
- **Settings -> About:** `UpdateInfoCard` (`mobile/app/about.tsx` hosts it) shows version/
  build, running update id (or "Built-in bundle"), channel, runtime version, install source,
  and a "Check for updates" button. Link it from the Settings screen.
- **Channels:** default `production` (baked into `app.json` via `expo-channel-name`). Build
  a staging binary with `IRIS_OTA_CHANNEL=staging` (read by `mobile/app.config.js`) and
  publish with `--channel staging`.
- Updates are disabled in dev clients (`__DEV__`).

## Releasing an update

Prereqs: real private key in `~/.iris-ota/private-key.pem`, `ssh` key `~/.ssh/iris-oracle.key`
(same defaults as `deploy/deploy.sh`; override with `IRIS_HOST`, `IRIS_USER`, `IRIS_KEY`).

```bash
# 1. dry run (default): exports, builds the manifest, signs, stages in ./ota-out, prints the ssh/scp plan
node scripts/ota-publish.mjs publish --channel staging --message "fix: ..."
# 2. upload to staging, test on a staging build, then
node scripts/ota-publish.mjs publish --channel staging --upload
node scripts/ota-publish.mjs publish --channel production --upload
```

Options: `--platform android|ios`, `--runtime-version <rv>` (skip auto-resolve),
`--base-url https://host/updates`, `--key`, `--cert`, `--export-dir` (use a prior
`expo export`), `--sync-server` (also copy `updates-server/server.mjs`), `--out`.

An update only reaches binaries with the **same runtime version** (and channel). Native
changes -> new APK -> new runtime version -> JS-only updates from then on.

### Rollback

```bash
node scripts/ota-publish.mjs rollback --channel production --runtime-version <rv> --upload
```
Publishes a signed `rollBackToEmbedded` directive: clients revert to the bundle inside
their APK. To go back to a specific earlier update instead, re-run `publish` from that
commit (updates are ordered by creation time, so a re-publish is "newer"). Fastest
emergency stop without a key: delete `channels/<ch>/<rv>/<platform>/current.json` on the
server (clients keep what they have; nothing new is served).

## Enabling the server on the VM (not done automatically)

```bash
node scripts/ota-publish.mjs publish --channel production --sync-server --upload   # creates ~/iris/updates-data + updates-server
scp -i ~/.ssh/iris-oracle.key deploy/docker-compose.prod.yml deploy/Caddyfile opc@129.225.92.235:~/iris/
ssh -i ~/.ssh/iris-oracle.key opc@129.225.92.235 'cd ~/iris && docker compose -f docker-compose.prod.yml --profile updates up -d updates && docker compose -f docker-compose.prod.yml restart caddy'
curl https://129-225-92-235.sslip.io/updates/healthz
```
`deploy.sh` re-copies the compose/Caddyfile, so later runs keep the route; the `updates`
service stays under its profile (`docker compose ... --profile updates up -d`). Old
releases and assets accumulate under `updates-data/`; prune manually.

## Binary (native) updates

OTA cannot change native code. `useNativeUpdate` (Android) reads `<updates>/native.json`:

```bash
node scripts/ota-publish.mjs native --latest-version-code 2 --latest-version 0.2.0 \
  --min-version-code 2 --apk-url https://github.com/<owner>/<repo>/releases/tag/v0.2.0 --upload
```
It compares `Application.nativeBuildVersion` (= `android.versionCode`, bump it every
release) and shows the banner ("Update available", "(required)" when below
`minVersionCode`). Tapping it:

- **Sideloaded build** (`extra.iris.distribution = "sideload"`, default): opens the
  GitHub Releases page for the signed APK. The user installs it manually; **no APK
  self-install is implemented.** Only `https://github.com/<owner>/<repo>/releases...` URLs are
  honoured.
- **Play build** (build with `IRIS_DISTRIBUTION=play`): opens the Play listing
  (`market://details?id=com.iris.chat.mobile`). For Play's own *in-app* update flow
  (flexible/immediate), add a native module such as `sp-react-native-in-app-updates` and
  call it from the `open` handler in `useNativeUpdate`; that needs a Play-signed build and
  was not added to avoid an extra native dependency (and it would change the fingerprint).

## Tests

`cd updates-server && npm test` runs server tests (manifest selection, signature
passthrough, rollback directive, assets, channel/runtime/platform routing, input
validation) and the publish-script tests (dry run uploads nothing, end-to-end
sign -> serve -> verify against the certificate, mismatched-key refusal). Needs `openssl`
on PATH for the publish test (skipped otherwise).

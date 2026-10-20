#!/usr/bin/env node
// Build, SIGN (locally, offline key) and optionally upload an Iris OTA update.
//
//   node scripts/ota-publish.mjs [publish] --channel production            # dry run (default)
//   node scripts/ota-publish.mjs publish --channel production --upload     # really upload
//   node scripts/ota-publish.mjs rollback --channel production --runtime-version <rv> --upload
//   node scripts/ota-publish.mjs native --latest-version-code 2 --latest-version 0.2.0 \
//        --min-version-code 2 --apk-url https://github.com/<owner>/<repo>/releases/... [--upload]
//
// The private key is read from --key / $IRIS_OTA_PRIVATE_KEY / ~/.iris-ota/private-key.pem
// and NEVER leaves this machine; only the signature is uploaded. See docs/ota-updates.md.
import { createHash, createSign, createVerify, randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MOBILE = join(ROOT, 'mobile')
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const KEY_ID = 'main'
const ALG = 'rsa-v1_5-sha256'

export const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const sha256b64url = buf => b64url(createHash('sha256').update(buf).digest())

export function signBody(body, privateKeyPem) {
  const sig = createSign('RSA-SHA256').update(body).sign(privateKeyPem, 'base64')
  return `sig="${sig}", keyid="${KEY_ID}", alg="${ALG}"`
}

/** Throws unless `header` verifies `body` under the certificate (also proves key <-> cert match). */
export function verifySignature(body, header, certPem) {
  const sig = /sig="([^"]+)"/.exec(header)?.[1]
  if (!sig) throw new Error('malformed signature header')
  const pub = new X509Certificate(certPem).publicKey
  if (!createVerify('RSA-SHA256').update(body).verify(pub, sig, 'base64')) {
    throw new Error('signature does not verify against the embedded certificate - wrong private key?')
  }
}

export function parseArgs(argv) {
  const [first, ...rest] = argv
  const cmd = ['publish', 'rollback', 'native'].includes(first) ? first : 'publish'
  const args = cmd === first ? rest : argv
  const o = { cmd, upload: false, flags: {} }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`)
    const k = a.slice(2)
    if (k === 'upload') o.upload = true
    else if (k === 'dry-run') o.upload = false
    else if (k === 'sync-server') o.flags.syncServer = true
    else {
      if (i + 1 >= args.length) throw new Error(`--${k} needs a value`)
      o.flags[k] = args[++i]
    }
  }
  return o
}

function loadConfig(f) {
  const appJson = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')).expo
  const url = f['base-url'] ?? appJson.updates.url.replace(/\/manifest$/, '')
  const channel = f.channel ?? 'production'
  const platform = f.platform ?? 'android'
  if (!NAME_RE.test(channel)) throw new Error('invalid --channel')
  if (platform !== 'android' && platform !== 'ios') throw new Error('invalid --platform')
  const keyPath = f.key ?? process.env.IRIS_OTA_PRIVATE_KEY ?? join(homedir(), '.iris-ota', 'private-key.pem')
  const certPath = f.cert ?? join(MOBILE, appJson.updates.codeSigningCertificate)
  return { appJson, baseUrl: url.replace(/\/$/, ''), channel, platform, keyPath, certPath, outDir: resolve(f.out ?? join(ROOT, 'ota-out')) }
}

function loadKeys(cfg) {
  if (!existsSync(cfg.keyPath)) {
    throw new Error(`private key not found at ${cfg.keyPath}. Generate one (docs/ota-updates.md) or pass --key / IRIS_OTA_PRIVATE_KEY.`)
  }
  const privateKey = readFileSync(cfg.keyPath, 'utf8')
  const certPem = readFileSync(cfg.certPath, 'utf8')
  const cert = new X509Certificate(certPem)
  if (cert.validToDate < new Date()) throw new Error('code-signing certificate has expired - rotate (docs/ota-updates.md)')
  const probe = Buffer.from('probe')
  verifySignature(probe, signBody(probe, privateKey), certPem) // key must match cert
  if (/DEV/.test(cert.subject)) console.warn('WARNING: signing with the DEV certificate - do not ship this to real users.')
  return { privateKey, certPem }
}

function resolveRuntimeVersion(f, platform) {
  if (f['runtime-version']) return f['runtime-version']
  const out = execFileSync('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', platform], { cwd: MOBILE, shell: true, encoding: 'utf8' })
  const rv = JSON.parse(out.trim().split('\n').pop()).runtimeVersion
  if (!rv) throw new Error('could not resolve runtime version')
  return rv
}

function exportBundle(f, platform) {
  if (f['export-dir']) return resolve(f['export-dir'])
  const dir = join(MOBILE, 'dist-ota')
  rmSync(dir, { recursive: true, force: true })
  execFileSync('npx', ['expo', 'export', '--platform', platform, '--output-dir', dir], { cwd: MOBILE, shell: true, stdio: 'inherit' })
  return dir
}

function expoClient(f) {
  if (f['expo-config']) return JSON.parse(readFileSync(f['expo-config'], 'utf8'))
  const out = execFileSync('npx', ['expo', 'config', '--json', '--type', 'public'], { cwd: MOBILE, shell: true, encoding: 'utf8' })
  return JSON.parse(out.slice(out.indexOf('{')))
}

const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json', mp3: 'audio/mpeg', mp4: 'video/mp4' }

/** Stage an asset (content-addressed) into outDir and return its manifest entry. */
function stageAsset(exportDir, relPath, ext, outDir, { launch }) {
  const bytes = readFileSync(join(exportDir, relPath))
  const hash = sha256b64url(bytes)
  mkdirSync(join(outDir, 'assets'), { recursive: true })
  writeFileSync(join(outDir, 'assets', hash), bytes)
  const fileExtension = launch ? '.bundle' : ext ? `.${ext.replace(/^\./, '')}` : ''
  return {
    hash,
    key: createHash('md5').update(bytes).digest('hex'),
    contentType: launch ? 'application/javascript' : EXT_MIME[ext?.replace(/^\./, '')] ?? 'application/octet-stream',
    fileExtension,
    url: '', // filled by caller (needs baseUrl)
  }
}

export function buildManifest({ exportDir, platform, runtimeVersion, channel, baseUrl, message, client, outDir, now = new Date() }) {
  const meta = JSON.parse(readFileSync(join(exportDir, 'metadata.json'), 'utf8')).fileMetadata?.[platform]
  if (!meta?.bundle) throw new Error(`export has no ${platform} bundle`)
  const withUrl = a => ({ ...a, url: `${baseUrl}/assets/${a.hash}${a.fileExtension}` })
  const launchAsset = withUrl(stageAsset(exportDir, meta.bundle, null, outDir, { launch: true }))
  const seen = new Set()
  const assets = []
  for (const a of meta.assets ?? []) {
    const entry = withUrl(stageAsset(exportDir, a.path, a.ext, outDir, { launch: false }))
    if (seen.has(entry.hash + entry.fileExtension)) continue
    seen.add(entry.hash + entry.fileExtension)
    assets.push(entry)
  }
  return {
    id: randomUUID(),
    createdAt: now.toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
    metadata: { channel, ...(message ? { message } : {}) },
    extra: { expoClient: client },
  }
}

export function stageRelease({ outDir, id, body, signature, kind, channel, runtimeVersion, platform }) {
  const dir = join(outDir, 'releases', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'body.json'), body)
  writeFileSync(join(dir, 'signature.txt'), signature)
  const ptrDir = join(outDir, 'channels', channel, runtimeVersion, platform)
  mkdirSync(ptrDir, { recursive: true })
  writeFileSync(join(ptrDir, 'current.json'), JSON.stringify({ kind, id }))
}

/** Ordered shell commands: assets first, release next, pointer LAST (atomic mv). */
export function uploadPlan({ outDir, id, channel, runtimeVersion, platform, ssh }) {
  const remote = `${ssh.user}@${ssh.host}`
  const base = '~/iris/updates-data'
  const ptr = `${base}/channels/${channel}/${runtimeVersion}/${platform}`
  const sshA = ['ssh', '-i', ssh.key, '-o', 'ConnectTimeout=15', remote]
  const scpA = ['scp', '-i', ssh.key, '-q']
  const assetsDir = join(outDir, 'assets')
  const assetFiles = existsSync(assetsDir) ? readdirSync(assetsDir).map(n => join(assetsDir, n)) : []
  const plan = [[...sshA, `mkdir -p ${base}/assets ${base}/releases ${ptr}`]]
  if (assetFiles.length) plan.push([...scpA, ...assetFiles, `${remote}:${base}/assets/`])
  plan.push([...scpA, '-r', join(outDir, 'releases', id), `${remote}:${base}/releases/`])
  plan.push([...scpA, join(outDir, 'channels', channel, runtimeVersion, platform, 'current.json'), `${remote}:${ptr}/current.json.tmp`])
  plan.push([...sshA, `mv ${ptr}/current.json.tmp ${ptr}/current.json`])
  return plan
}

function sshConfig() {
  return {
    host: process.env.IRIS_HOST ?? '129.225.92.235',
    user: process.env.IRIS_USER ?? 'opc',
    key: process.env.IRIS_KEY ?? join(homedir(), '.ssh', 'iris-oracle.key'),
  }
}

function runPlan(plan, upload) {
  for (const cmd of plan) {
    console.log((upload ? '$ ' : '[dry-run] ') + cmd.join(' '))
    if (upload) execFileSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
  }
}

export async function main(argv) {
  const { cmd, upload, flags: f } = parseArgs(argv)
  const ssh = sshConfig()

  if (cmd === 'native') {
    const outDir = resolve(f.out ?? join(ROOT, 'ota-out'))
    const lvc = Number(f['latest-version-code'])
    const mvc = Number(f['min-version-code'] ?? f['latest-version-code'])
    if (!Number.isInteger(lvc) || !Number.isInteger(mvc)) throw new Error('--latest-version-code and --min-version-code must be integers')
    const info = { latestVersionCode: lvc, latestVersion: f['latest-version'] ?? String(lvc), minVersionCode: mvc, apkUrl: f['apk-url'], playStoreUrl: f['play-url'], notes: f.notes }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'native.json'), JSON.stringify(info, null, 2))
    const remote = `${ssh.user}@${ssh.host}`
    runPlan([
      ['scp', '-i', ssh.key, '-q', join(outDir, 'native.json'), `${remote}:~/iris/updates-data/native.json`],
    ], upload)
    return { outDir }
  }

  const cfg = loadConfig(f)
  const { privateKey, certPem } = loadKeys(cfg)
  const runtimeVersion = resolveRuntimeVersion(f, cfg.platform)
  if (!NAME_RE.test(runtimeVersion)) throw new Error('unsafe runtime version')
  // Fresh staging dir per publish so stale files are never uploaded.
  rmSync(cfg.outDir, { recursive: true, force: true })
  mkdirSync(cfg.outDir, { recursive: true })

  let id, body, kind
  if (cmd === 'rollback') {
    id = randomUUID()
    kind = 'directive'
    body = JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime: new Date().toISOString() } })
  } else {
    const exportDir = exportBundle(f, cfg.platform)
    const manifest = buildManifest({ exportDir, platform: cfg.platform, runtimeVersion, channel: cfg.channel, baseUrl: cfg.baseUrl, message: f.message, client: expoClient(f), outDir: cfg.outDir })
    id = manifest.id
    kind = 'manifest'
    body = JSON.stringify(manifest)
  }
  const signature = signBody(body, privateKey)
  verifySignature(body, signature, certPem)
  stageRelease({ outDir: cfg.outDir, id, body, signature, kind, channel: cfg.channel, runtimeVersion, platform: cfg.platform })

  console.log(`${upload ? 'UPLOADING' : 'DRY RUN (pass --upload to upload)'}: ${cmd} ${id}\n  channel=${cfg.channel} platform=${cfg.platform} runtimeVersion=${runtimeVersion}\n  staged in ${cfg.outDir}`)
  const plan = uploadPlan({ outDir: cfg.outDir, id, channel: cfg.channel, runtimeVersion, platform: cfg.platform, ssh })
  if (f.syncServer) {
    plan.unshift(
      ['ssh', '-i', ssh.key, `${ssh.user}@${ssh.host}`, 'mkdir -p ~/iris/updates-server'],
      ['scp', '-i', ssh.key, '-q', join(ROOT, 'updates-server', 'server.mjs'), `${ssh.user}@${ssh.host}:~/iris/updates-server/server.mjs`],
    )
  }
  runPlan(plan, upload)
  return { id, kind, runtimeVersion, outDir: cfg.outDir, plan }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch(e => {
    console.error(`ota-publish: ${e.message}`)
    process.exit(1)
  })
}

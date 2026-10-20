// Iris OTA update server: Expo Updates protocol v1, static-file backed, ZERO dependencies.
//
// The server holds NO signing key. It only serves artifacts that the publish script
// (scripts/ota-publish.mjs) signed offline: the manifest bytes and the `expo-signature`
// header value are passed through verbatim. Compromising this server therefore cannot
// make the app run attacker code (the app verifies the signature against the
// certificate embedded in the binary).
//
// Store layout (DATA_DIR):
//   channels/<channel>/<runtimeVersion>/<platform>/current.json  {"kind":"manifest"|"directive","id":"<release id>"}
//   releases/<id>/body.json        exact signed bytes (manifest or rollback directive)
//   releases/<id>/signature.txt    full `expo-signature` header value
//   assets/<base64url-sha256>      asset bytes, content-addressed
//   native.json                    optional binary-update info (see docs/ota-updates.md)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ASSET_RE = /^([A-Za-z0-9_-]{43})(\.[A-Za-z0-9]{1,8})?$/
const PLATFORMS = new Set(['android', 'ios'])
const MIME = {
  '.bundle': 'application/javascript',
  '.js': 'application/javascript',
  '.hbc': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
}

function first(v) {
  return Array.isArray(v) ? v[0] : v
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null
    throw e
  }
}

export function multipart(boundary, parts) {
  let out = ''
  for (const p of parts) {
    out += `--${boundary}\r\n`
    out += `content-disposition: form-data; name="${p.name}"\r\n`
    out += 'content-type: application/json; charset=utf-8\r\n'
    if (p.signature) out += `expo-signature: ${p.signature}\r\n`
    out += `\r\n${p.body}\r\n`
  }
  return out + `--${boundary}--\r\n`
}

async function handleManifest(req, res, url, dataDir) {
  const h = req.headers
  const q = url.searchParams
  const platform = first(h['expo-platform']) ?? q.get('platform')
  const runtimeVersion = first(h['expo-runtime-version']) ?? q.get('runtime-version')
  const channel = first(h['expo-channel-name']) ?? q.get('channel') ?? 'production'
  const protocol = first(h['expo-protocol-version']) ?? '1'

  if (protocol !== '1' && protocol !== '0') return send(res, 400, { error: 'unsupported expo-protocol-version' })
  if (!PLATFORMS.has(platform)) return send(res, 400, { error: 'expo-platform must be android|ios' })
  if (!NAME_RE.test(runtimeVersion ?? '')) return send(res, 400, { error: 'invalid expo-runtime-version' })
  if (!NAME_RE.test(channel)) return send(res, 400, { error: 'invalid expo-channel-name' })

  const pointerRaw = await readIfExists(join(dataDir, 'channels', channel, runtimeVersion, platform, 'current.json'))
  if (pointerRaw === null) return send(res, 404, { error: 'no update for this channel/runtime/platform' })
  let pointer
  try {
    pointer = JSON.parse(pointerRaw)
  } catch {
    return send(res, 500, { error: 'corrupt pointer' })
  }
  if (!NAME_RE.test(pointer.id ?? '') || (pointer.kind !== 'manifest' && pointer.kind !== 'directive')) {
    return send(res, 500, { error: 'corrupt pointer' })
  }
  const body = await readIfExists(join(dataDir, 'releases', pointer.id, 'body.json'))
  const signature = (await readIfExists(join(dataDir, 'releases', pointer.id, 'signature.txt')))?.trim() ?? null
  if (body === null) return send(res, 500, { error: 'release missing' })

  // The client asks for a signature when it has a code-signing certificate configured.
  const expectSignature = first(h['expo-expect-signature']) !== undefined
  if (expectSignature && !signature) return send(res, 500, { error: 'release is unsigned' })

  const boundary = randomBytes(12).toString('hex')
  const payload = multipart(boundary, [
    { name: pointer.kind === 'directive' ? 'directive' : 'manifest', body, signature: expectSignature ? signature : null },
  ])
  send(res, 200, payload, {
    'content-type': `multipart/mixed; boundary=${boundary}`,
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
  })
}

async function handleAsset(req, res, name, dataDir) {
  const m = ASSET_RE.exec(name)
  if (!m) return send(res, 400, { error: 'bad asset name' })
  const path = join(dataDir, 'assets', m[1])
  let st
  try {
    st = await stat(path)
  } catch {
    return send(res, 404, { error: 'not found' })
  }
  res.writeHead(200, {
    'content-type': MIME[(m[2] ?? '').toLowerCase()] ?? 'application/octet-stream',
    'content-length': st.size,
    // content-addressed: safe to cache forever
    'cache-control': 'public, max-age=31536000, immutable',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(path).pipe(res)
}

export function createHandler({ dataDir }) {
  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD' })
      const url = new URL(req.url, 'http://localhost')
      const path = url.pathname
      if (path === '/healthz') return send(res, 200, { ok: true })
      if (path === '/manifest') return await handleManifest(req, res, url, dataDir)
      if (path.startsWith('/assets/')) return await handleAsset(req, res, path.slice('/assets/'.length), dataDir)
      if (path === '/native.json') {
        const raw = await readIfExists(join(dataDir, 'native.json'))
        if (raw === null) return send(res, 404, { error: 'not found' })
        return send(res, 200, raw, { 'cache-control': 'public, max-age=300' })
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      console.error('update-server error', e)
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
      else res.end()
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8081)
  const dataDir = process.env.DATA_DIR ?? '/data'
  createServer(createHandler({ dataDir })).listen(port, '0.0.0.0', () => console.log(`iris update server on :${port} (data ${dataDir})`))
}

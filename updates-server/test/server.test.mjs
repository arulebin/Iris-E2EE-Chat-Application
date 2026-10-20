import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../server.mjs'

const HASH = 'A'.repeat(43)
const SIG = 'sig="abc123==", keyid="main", alg="rsa-v1_5-sha256"'

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'iris-ota-'))
  const put = (rel, content) => {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
  return { dir, put }
}

async function withServer(dir, fn) {
  const srv = createServer(createHandler({ dataDir: dir }))
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    await fn(base)
  } finally {
    srv.close()
  }
}

const hdr = (o = {}) => ({ 'expo-protocol-version': '1', 'expo-platform': 'android', 'expo-runtime-version': 'rv1', 'expo-channel-name': 'production', ...o })

function seed(s, { channel = 'production', rv = 'rv1', platform = 'android', id = 'r1', kind = 'manifest', body = '{"id":"r1"}', sig = SIG } = {}) {
  s.put(`channels/${channel}/${rv}/${platform}/current.json`, JSON.stringify({ kind, id }))
  s.put(`releases/${id}/body.json`, body)
  if (sig) s.put(`releases/${id}/signature.txt`, sig + '\n')
}

test('manifest: multipart with verbatim body and signature passthrough', async () => {
  const s = store()
  seed(s, { body: '{"id":"r1","note":"exact  bytes"}' })
  await withServer(s.dir, async base => {
    const r = await fetch(`${base}/manifest`, { headers: hdr({ 'expo-expect-signature': 'true' }) })
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('expo-protocol-version'), '1')
    assert.equal(r.headers.get('expo-sfv-version'), '0')
    assert.match(r.headers.get('content-type'), /^multipart\/mixed; boundary=/)
    const text = await r.text()
    assert.match(text, /name="manifest"/)
    assert.ok(text.includes(`expo-signature: ${SIG}\r\n`))
    assert.ok(text.includes('\r\n\r\n{"id":"r1","note":"exact  bytes"}\r\n'))
  })
})

test('manifest: signature header omitted when client does not expect one', async () => {
  const s = store()
  seed(s)
  await withServer(s.dir, async base => {
    const text = await (await fetch(`${base}/manifest`, { headers: hdr() })).text()
    assert.ok(!text.includes('expo-signature'))
  })
})

test('manifest: refuses to serve an unsigned release to a signature-expecting client', async () => {
  const s = store()
  seed(s, { sig: null })
  await withServer(s.dir, async base => {
    const r = await fetch(`${base}/manifest`, { headers: hdr({ 'expo-expect-signature': 'true' }) })
    assert.equal(r.status, 500)
  })
})

test('routing: channel, runtime version and platform select different releases', async () => {
  const s = store()
  seed(s, { id: 'prod', body: '{"id":"prod"}' })
  seed(s, { id: 'stg', channel: 'staging', body: '{"id":"stg"}' })
  seed(s, { id: 'rv2', rv: 'rv2', body: '{"id":"rv2"}' })
  seed(s, { id: 'ios', platform: 'ios', body: '{"id":"ios"}' })
  await withServer(s.dir, async base => {
    const get = async o => (await fetch(`${base}/manifest`, { headers: hdr(o) })).text()
    assert.match(await get({}), /"id":"prod"/)
    assert.match(await get({ 'expo-channel-name': 'staging' }), /"id":"stg"/)
    assert.match(await get({ 'expo-runtime-version': 'rv2' }), /"id":"rv2"/)
    assert.match(await get({ 'expo-platform': 'ios' }), /"id":"ios"/)
    const miss = await fetch(`${base}/manifest`, { headers: hdr({ 'expo-runtime-version': 'nope' }) })
    assert.equal(miss.status, 404)
  })
})

test('routing: channel defaults to production; query params work', async () => {
  const s = store()
  seed(s, { id: 'prod', body: '{"id":"prod"}' })
  await withServer(s.dir, async base => {
    const r = await fetch(`${base}/manifest?platform=android&runtime-version=rv1`)
    assert.match(await r.text(), /"id":"prod"/)
  })
})

test('rollback directive is served as a directive part', async () => {
  const s = store()
  const body = '{"type":"rollBackToEmbedded","parameters":{"commitTime":"2026-01-01T00:00:00.000Z"}}'
  seed(s, { id: 'rb', kind: 'directive', body })
  await withServer(s.dir, async base => {
    const text = await (await fetch(`${base}/manifest`, { headers: hdr({ 'expo-expect-signature': 'true' }) })).text()
    assert.match(text, /name="directive"/)
    assert.ok(text.includes(body))
    assert.ok(text.includes(`expo-signature: ${SIG}`))
  })
})

test('input validation: path traversal and bad values are rejected', async () => {
  const s = store()
  seed(s)
  await withServer(s.dir, async base => {
    for (const bad of [{ 'expo-channel-name': '../x' }, { 'expo-runtime-version': '..' }, { 'expo-platform': 'web' }, { 'expo-protocol-version': '9' }]) {
      const r = await fetch(`${base}/manifest`, { headers: hdr(bad) })
      assert.equal(r.status, 400, JSON.stringify(bad))
    }
    assert.equal((await fetch(`${base}/assets/..%2f..%2fetc%2fpasswd`)).status, 400)
  })
})

test('assets: content-addressed serving with immutable cache and mime by extension', async () => {
  const s = store()
  s.put(`assets/${HASH}`, 'hello-bytes')
  await withServer(s.dir, async base => {
    const r = await fetch(`${base}/assets/${HASH}.png`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('content-type'), 'image/png')
    assert.match(r.headers.get('cache-control'), /immutable/)
    assert.equal(await r.text(), 'hello-bytes')
    assert.equal((await fetch(`${base}/assets/${HASH}.bundle`)).headers.get('content-type'), 'application/javascript')
    assert.equal((await fetch(`${base}/assets/${'B'.repeat(43)}.png`)).status, 404)
    const head = await fetch(`${base}/assets/${HASH}.png`, { method: 'HEAD' })
    assert.equal(head.status, 200)
  })
})

test('native.json, healthz and method restrictions', async () => {
  const s = store()
  await withServer(s.dir, async base => {
    assert.equal((await fetch(`${base}/native.json`)).status, 404)
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    assert.equal((await fetch(`${base}/manifest`, { method: 'POST' })).status, 405)
    s.put('native.json', '{"latestVersionCode":3}')
    assert.deepEqual(await (await fetch(`${base}/native.json`)).json(), { latestVersionCode: 3 })
  })
})

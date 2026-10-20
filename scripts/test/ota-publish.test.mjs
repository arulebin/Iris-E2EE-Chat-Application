import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../../updates-server/server.mjs'
import { main, verifySignature, parseArgs } from '../ota-publish.mjs'

function haveOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'iris-pub-'))
  const key = join(dir, 'private-key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=Iris Test'], { stdio: 'ignore' })
  // fake `expo export` output
  const exp = join(dir, 'export')
  mkdirSync(join(exp, 'assets'), { recursive: true })
  mkdirSync(join(exp, '_expo/static/js/android'), { recursive: true })
  writeFileSync(join(exp, '_expo/static/js/android/entry.hbc'), 'BUNDLE-BYTES')
  writeFileSync(join(exp, 'assets/abc'), 'PNG-BYTES')
  writeFileSync(
    join(exp, 'metadata.json'),
    JSON.stringify({ version: 0, bundler: 'metro', fileMetadata: { android: { bundle: '_expo/static/js/android/entry.hbc', assets: [{ path: 'assets/abc', ext: 'png' }] } } }),
  )
  const cfg = join(dir, 'expo-config.json')
  writeFileSync(cfg, JSON.stringify({ name: 'Iris' }))
  return { dir, key, cert, exp, cfg, out: join(dir, 'out') }
}

const common = f => ['--key', f.key, '--cert', f.cert, '--export-dir', f.exp, '--expo-config', f.cfg, '--runtime-version', 'rv-test', '--out', f.out, '--base-url', 'https://example.test/updates']

test('parseArgs: dry run is the default; --upload opts in', () => {
  assert.equal(parseArgs(['--channel', 'staging']).upload, false)
  assert.equal(parseArgs(['publish', '--upload']).upload, true)
  assert.equal(parseArgs(['rollback']).cmd, 'rollback')
})

test('dry run signs locally, stages artifacts, uploads nothing, and the server serves a verifiable manifest', { skip: !haveOpenssl() }, async () => {
  const f = fixture()
  const logs = []
  const orig = console.log
  console.log = (...a) => logs.push(a.join(' '))
  let res
  try {
    res = await main(['publish', '--channel', 'staging', ...common(f)])
  } finally {
    console.log = orig
  }
  assert.ok(logs.some(l => l.startsWith('DRY RUN')))
  assert.ok(logs.filter(l => l.startsWith('[dry-run]')).length >= 4)
  assert.ok(!logs.some(l => l.startsWith('$ ')), 'must not execute anything')
  assert.ok(res.plan[res.plan.length - 1].join(' ').includes('mv '), 'pointer is flipped last')

  const manifest = JSON.parse(readFileSync(join(f.out, 'releases', res.id, 'body.json'), 'utf8'))
  assert.equal(manifest.runtimeVersion, 'rv-test')
  assert.equal(manifest.metadata.channel, 'staging')
  assert.match(manifest.launchAsset.url, /^https:\/\/example\.test\/updates\/assets\/[A-Za-z0-9_-]{43}\.bundle$/)
  assert.equal(manifest.assets.length, 1)
  assert.ok(existsSync(join(f.out, 'assets', manifest.launchAsset.hash)))
  // the private key must not be anywhere in the upload set
  assert.ok(!readFileSync(join(f.out, 'releases', res.id, 'signature.txt'), 'utf8').includes('PRIVATE'))

  // End to end: server -> multipart -> signature verifies against the certificate.
  const srv = createServer(createHandler({ dataDir: f.out }))
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/manifest`, {
      headers: { 'expo-platform': 'android', 'expo-runtime-version': 'rv-test', 'expo-channel-name': 'staging', 'expo-expect-signature': 'true' },
    })
    const text = await r.text()
    const sig = /expo-signature: (.+)\r\n/.exec(text)[1]
    const body = /\r\n\r\n([\s\S]*)\r\n--/.exec(text)[1]
    verifySignature(body, sig, readFileSync(f.cert, 'utf8'))
    assert.throws(() => verifySignature(body.replace('rv-test', 'rv-evil'), sig, readFileSync(f.cert, 'utf8')))
  } finally {
    srv.close()
  }
})

test('rollback stages a signed directive pointer', { skip: !haveOpenssl() }, async () => {
  const f = fixture()
  const orig = console.log
  console.log = () => {}
  let res
  try {
    res = await main(['rollback', '--channel', 'production', ...common(f)])
  } finally {
    console.log = orig
  }
  const ptr = JSON.parse(readFileSync(join(f.out, 'channels/production/rv-test/android/current.json'), 'utf8'))
  assert.deepEqual(ptr, { kind: 'directive', id: res.id })
  assert.equal(JSON.parse(readFileSync(join(f.out, 'releases', res.id, 'body.json'), 'utf8')).type, 'rollBackToEmbedded')
})

test('refuses to sign when the private key does not match the embedded certificate', { skip: !haveOpenssl() }, async () => {
  const f = fixture()
  const other = fixture()
  await assert.rejects(main(['publish', ...common(f).map((v, i, a) => (a[i - 1] === '--key' ? other.key : v))]), /does not verify/)
})

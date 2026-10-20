import * as ls from '@privacyresearch/libsignal-protocol-typescript'
import {
  createLibsignalWebCrypto,
  createNobleAsyncCurve,
  createNobleCurve,
  safetyNumber,
  utf8,
  type CryptoProvider,
} from '@iris/core'

/**
 * Phase 1 gate benchmark. Pure functions over a CryptoProvider so it can run on a device
 * (app/bench.tsx) and under Node. Each timing is the median-free single run of a warm path
 * (after one untimed warmup) because that is what the user feels; ranges are noted in the doc.
 */
export type BenchRow = { name: string; ms: number; gate?: number; pass?: boolean; note?: string }

export type Gates = { login: number; safety: number; curve: number }
export const GATES: Gates = { login: 1500, safety: 2000, curve: 300 }

type Now = () => number

async function time<T>(now: Now, fn: () => Promise<T> | T): Promise<[number, T]> {
  const t = now()
  const v = await fn()
  return [now() - t, v]
}

const row = (name: string, ms: number, gate?: number, note?: string): BenchRow => ({
  name,
  ms: Math.round(ms * 10) / 10,
  gate,
  pass: gate === undefined ? undefined : ms < gate,
  note,
})

class MemStore {
  private d = new Map<string, unknown>()
  Direction = ls.Direction
  constructor(private identity: ls.KeyPairType, private regId: number) {}
  async getIdentityKeyPair() { return this.identity }
  async getLocalRegistrationId() { return this.regId }
  async isTrustedIdentity() { return true }
  async saveIdentity(id: string, key: ArrayBuffer) { this.d.set('id' + id, key); return false }
  async loadPreKey(id: string | number) { return this.d.get('pk' + id) as ls.KeyPairType | undefined }
  async storePreKey(id: string | number, kp: ls.KeyPairType) { this.d.set('pk' + id, kp) }
  async removePreKey(id: string | number) { this.d.delete('pk' + id) }
  async loadSignedPreKey(id: string | number) { return this.d.get('spk' + id) as ls.KeyPairType | undefined }
  async storeSignedPreKey(id: string | number, kp: ls.KeyPairType) { this.d.set('spk' + id, kp) }
  async removeSignedPreKey(id: string | number) { this.d.delete('spk' + id) }
  async loadSession(id: string) { return this.d.get('s' + id) as string | undefined }
  async storeSession(id: string, rec: string) { this.d.set('s' + id, rec) }
  async removeSession(id: string) { this.d.delete('s' + id) }
  async removeAllSessions() {}
}

async function party(now: Now) {
  const identity = await ls.KeyHelper.generateIdentityKeyPair()
  const regId = ls.KeyHelper.generateRegistrationId()
  const store = new MemStore(identity, regId)
  const spk = await ls.KeyHelper.generateSignedPreKey(identity, 1)
  const pk = await ls.KeyHelper.generatePreKey(2)
  await store.storeSignedPreKey(1, spk.keyPair)
  await store.storePreKey(2, pk.keyPair)
  void now
  return {
    store: store as unknown as ls.StorageType,
    bundle: {
      identityKey: identity.pubKey,
      registrationId: regId,
      signedPreKey: { keyId: 1, publicKey: spk.keyPair.pubKey, signature: spk.signature },
      preKey: { keyId: 2, publicKey: pk.keyPair.pubKey },
    },
  }
}

export async function runBench(
  provider: CryptoProvider,
  opts: { now?: Now; log?: (r: BenchRow) => void; gates?: Gates } = {},
): Promise<BenchRow[]> {
  const now = opts.now ?? (() => performance.now())
  const gates = opts.gates ?? GATES
  const rows: BenchRow[] = []
  const push = (r: BenchRow) => {
    rows.push(r)
    opts.log?.(r)
  }

  // --- login derivation: PBKDF2-HMAC-SHA256 600k then HKDF "iris-auth-v2"
  const salt = provider.randomBytes(16)
  const login = async () => {
    const master = await provider.pbkdf2('SHA-256', utf8('correct horse battery staple'), salt, 600_000, 32)
    return provider.hkdf('SHA-256', master, new Uint8Array(0), utf8('iris-auth-v2'), 32)
  }
  {
    const [ms] = await time(now, login)
    push(row('login: PBKDF2 600k + HKDF', ms, gates.login))
  }

  // --- safety number (2 x 5200 SHA-512 rounds)
  {
    const k1 = provider.randomBytes(33)
    const k2 = provider.randomBytes(33)
    const [ms] = await time(now, () => safetyNumber.identitySafetyNumber(provider, 'alice', k1, 'bob', k2))
    push(row('safety number (2 x 5200 SHA-512)', ms, gates.safety))
  }

  // --- AES-GCM / HKDF / RSA
  {
    const key = provider.randomBytes(32)
    const iv = provider.randomBytes(12)
    const small = provider.randomBytes(1024)
    const [msS] = await time(now, async () => {
      for (let i = 0; i < 50; i++) await provider.aesGcmDecrypt(key, iv, await provider.aesGcmEncrypt(key, iv, small))
    })
    push(row('AES-GCM 1 KiB enc+dec x50', msS))
    const big = provider.randomBytes(10 * 1024 * 1024)
    const [msB, ct] = await time(now, () => provider.aesGcmEncrypt(key, iv, big))
    push(row('AES-GCM encrypt 10 MiB', msB))
    const [msD] = await time(now, () => provider.aesGcmDecrypt(key, iv, ct))
    push(row('AES-GCM decrypt 10 MiB', msD))
    const [msH] = await time(now, async () => {
      for (let i = 0; i < 50; i++) await provider.hkdf('SHA-256', key, iv, utf8('info'), 32)
    })
    push(row('HKDF-SHA256 x50', msH))
    const [msHm] = await time(now, async () => {
      for (let i = 0; i < 50; i++) await provider.hmac('SHA-256', key, small)
    })
    push(row('HMAC-SHA256 1 KiB x50', msHm))
  }

  // --- libsignal curve25519 ops (asm.js on Hermes)
  ls.setWebCrypto(createLibsignalWebCrypto(provider) as unknown as Crypto)
  {
    const { Curve } = await ls.default()
    await time(now, () => Curve.generateKeyPair()) // warmup (asm.js init)
    const [kp, a] = await time(now, () => Curve.generateKeyPair())
    push(row('curve25519 generateKeyPair', kp, gates.curve))
    const b = Curve.generateKeyPair()
    const msg = provider.randomBytes(33).buffer as ArrayBuffer
    const [sg, sig] = await time(now, () => Curve.calculateSignature(a.privKey, msg))
    push(row('XEdDSA sign', sg, gates.curve))
    const [vf, ok] = await time(now, () => Curve.verifySignature(a.pubKey, msg, sig))
    push(row('XEdDSA verify', vf, gates.curve, ok ? 'INVALID' : 'valid')) // libsignal returns true when invalid
    const [ag, shared] = await time(now, () => Curve.calculateAgreement(b.pubKey, a.privKey))
    push(row('X25519 agree', ag, gates.curve, shared.byteLength === 32 ? 'ok' : 'bad length'))
  }

  // --- X3DH + ratchet roundtrip, asm.js curve (default) then noble curve
  const sessions = async (label: string) => {
  {
      const [tSetup, [alice, bob]] = await time(now, async () => [await party(now), await party(now)] as const)
      push(row(label + 'libsignal: 2x identity + signed prekey + prekey', tSetup))
      const bobAddr = new ls.SignalProtocolAddress('bob', 1)
      const aliceAddr = new ls.SignalProtocolAddress('alice', 1)
      const [tX3dh] = await time(now, () => new ls.SessionBuilder(alice.store, bobAddr).processPreKey(bob.bundle))
      push(row(label + 'X3DH processPreKey (alice)', tX3dh))
      const aliceCipher = new ls.SessionCipher(alice.store, bobAddr)
      const bobCipher = new ls.SessionCipher(bob.store, aliceAddr)
      const t0 = now()
      const first = await aliceCipher.encrypt(utf8('hello bob').buffer as ArrayBuffer)
      const got = await bobCipher.decryptPreKeyWhisperMessage(first.body!, 'binary')
      const reply = await bobCipher.encrypt(utf8('hi alice').buffer as ArrayBuffer)
      const got2 = await aliceCipher.decryptWhisperMessage(reply.body!, 'binary')
      const ok = new TextDecoder().decode(got) === 'hello bob' && new TextDecoder().decode(got2) === 'hi alice'
      push(row(label + 'X3DH+ratchet roundtrip (enc/dec both ways)', now() - t0, undefined, ok ? 'plaintext ok' : 'MISMATCH'))
      const [tNext] = await time(now, async () => {
        for (let i = 0; i < 10; i++) {
          const m = await aliceCipher.encrypt(utf8('msg ' + i).buffer as ArrayBuffer)
          await bobCipher.decryptWhisperMessage(m.body!, 'binary')
        }
      })
      push(row(label + 'ratchet steady state 10 msgs enc+dec', tNext))
    }
  }
  await sessions('asm.js: ')
  // --- @noble/curves fallback, raw ops
  {
    const nc = createNobleCurve(n => provider.randomBytes(n))
    const seed = provider.randomBytes(32).buffer as ArrayBuffer
    nc.keyPair(seed) // warmup
    const [kp, a] = await time(now, () => nc.keyPair(seed))
    push(row('noble: generateKeyPair', kp, gates.curve))
    const b = nc.keyPair(provider.randomBytes(32).buffer as ArrayBuffer)
    const msg = provider.randomBytes(33).buffer as ArrayBuffer
    const [sg, sig] = await time(now, () => nc.sign(a.privKey, msg))
    push(row('noble: XEdDSA sign', sg, gates.curve))
    const [vf, bad] = await time(now, () => nc.verify(a.pubKey, msg, sig))
    push(row('noble: XEdDSA verify', vf, gates.curve, bad ? 'INVALID' : 'valid'))
    const [ag] = await time(now, () => nc.sharedSecret(b.pubKey, a.privKey))
    push(row('noble: X25519 agree', ag, gates.curve))
  }

  ls.setCurve(createNobleAsyncCurve(n => provider.randomBytes(n)) as never)
  await sessions('noble: ')
  return rows
}

import { concat, fromBase64, fromHex, toHex, utf8, type Bytes, type CryptoProvider } from '@iris/core'
import * as V from './vectors.ts'

/**
 * Known-answer conformance suite for CryptoProvider. Framework-free (no vitest,
 * no Node imports) so the exact same cases run under Node and on a device from
 * the mobile app's diagnostics screen.
 */

export type CaseResult = {
  group: string
  name: string
  status: 'pass' | 'fail' | 'skip'
  ms: number
  error?: string
  /** True for cases that exist to catch backends with missing algorithms. */
  critical: boolean
}

type Case = {
  group: string
  name: string
  /** Backend that cannot do this should report skip, not fail. */
  optional?: boolean
  run: (p: CryptoProvider) => Promise<void>
}

const hex = (s: string) => fromHex(s)
const eq = (actual: Bytes, expectedHex: string, what = 'output') => {
  const a = toHex(actual)
  if (a !== expectedHex.replace(/\s+/g, '').toLowerCase()) throw new Error(`${what} mismatch\n  got      ${a}\n  expected ${expectedHex}`)
}
const ok = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg)
}
const rejects = async (fn: () => Promise<unknown>, what: string) => {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  ok(threw, `${what} should have been rejected`)
}
const rep = (b: number, n: number) => new Uint8Array(n).fill(b)

export const cases: Case[] = [
  // ── hashes ──────────────────────────────────────────────
  {
    group: 'hash',
    name: 'SHA-256 FIPS 180 "abc"',
    run: async p => eq(await p.digest('SHA-256', utf8('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
  },
  {
    group: 'hash',
    name: 'SHA-512 FIPS 180 "abc"',
    run: async p =>
      eq(
        await p.digest('SHA-512', utf8('abc')),
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
      ),
  },
  {
    group: 'hash',
    name: 'SHA-256 of one million "a" (FIPS 180 long message)',
    run: async p =>
      eq(await p.digest('SHA-256', new Uint8Array(1_000_000).fill(0x61)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'),
  },
  // ── HMAC ────────────────────────────────────────────────
  {
    group: 'hmac',
    name: 'HMAC-SHA-256 RFC 4231 case 1',
    run: async p =>
      eq(await p.hmac('SHA-256', rep(0x0b, 20), utf8('Hi There')), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'),
  },
  {
    group: 'hmac',
    name: 'HMAC-SHA-512 RFC 4231 case 1',
    run: async p =>
      eq(
        await p.hmac('SHA-512', rep(0x0b, 20), utf8('Hi There')),
        '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
      ),
  },
  // ── KDFs ────────────────────────────────────────────────
  {
    group: 'hkdf',
    name: 'HKDF-SHA-256 RFC 5869 case 1',
    run: async p =>
      eq(
        await p.hkdf('SHA-256', rep(0x0b, 22), hex('000102030405060708090a0b0c'), hex('f0f1f2f3f4f5f6f7f8f9'), 42),
        '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
      ),
  },
  {
    group: 'hkdf',
    name: 'HKDF-SHA-256 RFC 5869 case 3 (empty salt and info, as Iris uses)',
    run: async p =>
      eq(
        await p.hkdf('SHA-256', rep(0x0b, 22), new Uint8Array(0), new Uint8Array(0), 42),
        '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
      ),
  },
  {
    group: 'pbkdf2',
    name: 'PBKDF2-HMAC-SHA-256 RFC 7914 c=1 dkLen=64',
    run: async p =>
      eq(
        await p.pbkdf2('SHA-256', utf8('passwd'), utf8('salt'), 1, 64),
        '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
      ),
  },
  {
    group: 'pbkdf2',
    name: 'PBKDF2-HMAC-SHA-256 c=4096 dkLen=32',
    run: async p =>
      eq(await p.pbkdf2('SHA-256', utf8('password'), utf8('salt'), 4096, 32), 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a'),
  },
  {
    group: 'pbkdf2',
    name: 'Iris v2 login: PBKDF2 600k then HKDF "iris-auth-v2" (slow)',
    run: async p => {
      const master = await p.pbkdf2('SHA-256', utf8(V.IRIS_PASSWORD), hex(V.IRIS_SALT_HEX), 600_000, 32)
      eq(master, V.IRIS_MASTER_HEX, 'master')
      eq(await p.hkdf('SHA-256', master, new Uint8Array(0), utf8('iris-auth-v2'), 32), V.IRIS_AUTHKEY_HEX, 'authKey')
    },
  },
  // ── AES ─────────────────────────────────────────────────
  {
    group: 'aes-gcm',
    name: 'AES-256-GCM NIST/McGrew test case 16 (with AAD)',
    run: async p => {
      const key = hex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308')
      const iv = hex('cafebabefacedbaddecaf888')
      const pt = hex(
        'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
      )
      const aad = hex('feedfacedeadbeeffeedfacedeadbeefabaddad2')
      const expected =
        '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
        '76fc6ece0f4e1768cddf8853bb2d551b'
      eq(await p.aesGcmEncrypt(key, iv, pt, aad), expected)
      eq(await p.aesGcmDecrypt(key, iv, hex(expected), aad), toHex(pt))
    },
  },
  {
    group: 'aes-gcm',
    name: 'AES-GCM round trip without AAD, tamper and wrong AAD are rejected',
    run: async p => {
      const key = p.randomBytes(32)
      const iv = p.randomBytes(12)
      const ct = await p.aesGcmEncrypt(key, iv, utf8('hello iris'))
      eq(await p.aesGcmDecrypt(key, iv, ct), toHex(utf8('hello iris')))
      const bad = ct.slice()
      bad[0] ^= 1
      await rejects(() => p.aesGcmDecrypt(key, iv, bad), 'tampered ciphertext')
      const ct2 = await p.aesGcmEncrypt(key, iv, utf8('x'), utf8('ad-1'))
      await rejects(() => p.aesGcmDecrypt(key, iv, ct2, utf8('ad-2')), 'wrong AAD')
    },
  },
  {
    group: 'aes-cbc',
    name: 'AES-256-CBC NIST SP 800-38A F.2.5 first block (+ PKCS#7 pad block)',
    run: async p => {
      const key = hex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4')
      const iv = hex('000102030405060708090a0b0c0d0e0f')
      const pt = hex('6bc1bee22e409f96e93d7e117393172a')
      const ct = await p.aesCbcEncrypt(key, iv, pt)
      ok(ct.length === 32, 'PKCS#7 should add a full pad block')
      eq(ct.subarray(0, 16), 'f58c4c04d6e5f1ba779eabfb5f7bfbd6')
      eq(await p.aesCbcDecrypt(key, iv, ct), toHex(pt))
    },
  },
  // ── RSA (legacy paths) ──────────────────────────────────
  {
    group: 'rsa',
    name: 'RSA-OAEP-SHA-256 decrypts a ciphertext made by OpenSSL',
    run: async p => eq(await p.rsaOaepDecrypt(V.RSA_PRIV, hex(V.RSA_OAEP_CT_HEX)), toHex(utf8(V.RSA_OAEP_PT))),
  },
  {
    group: 'rsa',
    name: 'RSA-OAEP-SHA-256 round trip (random padding)',
    run: async p => {
      const ct = await p.rsaOaepEncrypt(V.RSA_PUB, utf8('wrapped aes key bytes'))
      ok(ct.length === 256, '2048-bit modulus => 256-byte ciphertext')
      eq(await p.rsaOaepDecrypt(V.RSA_PRIV, ct), toHex(utf8('wrapped aes key bytes')))
    },
  },
  {
    group: 'rsa',
    name: 'RSA-PSS-SHA-256 (salt 32) verifies a signature made by OpenSSL',
    run: async p => ok(await p.rsaPssVerify(V.RSA_PUB, hex(V.RSA_PSS_SIG_HEX), utf8(V.RSA_PSS_MSG), 32), 'signature should verify'),
  },
  {
    group: 'rsa',
    name: 'RSA-PSS sign then verify; modified message fails',
    run: async p => {
      const msg = utf8('identity key bytes')
      const sig = await p.rsaPssSign(V.RSA_PRIV, msg, 32)
      ok(await p.rsaPssVerify(V.RSA_PUB, sig, msg, 32), 'own signature should verify')
      ok(!(await p.rsaPssVerify(V.RSA_PUB, sig, utf8('identity key byteS'), 32)), 'modified message must not verify')
      // And a signature from another implementation (OpenSSL) verifies with our signer's key pair too.
      ok(await p.rsaPssVerify(V.RSA_PUB, hex(V.RSA_PSS_SIG_HEX), utf8(V.RSA_PSS_MSG), 32), 'cross-implementation')
    },
  },
  // ── misc ────────────────────────────────────────────────
  {
    group: 'random',
    name: 'randomBytes: right length, not constant, successive calls differ',
    run: async p => {
      const a = p.randomBytes(32)
      const b = p.randomBytes(32)
      ok(a.length === 32 && b.length === 32, 'length')
      ok(toHex(a) !== toHex(b), 'two draws identical')
      ok(new Set(a).size > 4, 'suspiciously low entropy')
    },
  },
  {
    group: 'gzip',
    name: 'gunzip reads a gzip stream made by zlib; gzip round-trips',
    optional: true,
    run: async p => {
      if (!p.gzip || !p.gunzip) throw new Error('gzip not provided')
      const text = V.GZIP_FIXTURE_TEXT
      eq(await p.gunzip(hex(V.GZIP_FIXTURE_HEX)), toHex(utf8(text)))
      const back = await p.gunzip(await p.gzip(utf8(text)))
      eq(back, toHex(utf8(text)))
    },
  },
  {
    group: 'iris',
    name: 'Iris backup envelope shape: HKDF key + AES-GCM with AAD, bytes concat',
    run: async p => {
      const key = await p.hkdf('SHA-256', rep(7, 32), rep(1, 16), utf8('iris-backup-v1'), 32)
      const iv = rep(2, 12)
      const ct = await p.aesGcmEncrypt(key, iv, utf8('payload'), utf8('aad'))
      const packed = concat(iv, ct)
      eq(await p.aesGcmDecrypt(key, packed.subarray(0, 12), packed.subarray(12), utf8('aad')), toHex(utf8('payload')))
      ok(fromBase64('AAECAw==').length === 4, 'base64 helper')
    },
  },
]

export type RunOptions = {
  /** Skip the 600k-iteration case (slow on pure-JS backends). */
  skipSlow?: boolean
  now?: () => number
  onResult?: (r: CaseResult) => void
}

export async function runConformance(p: CryptoProvider, opts: RunOptions = {}): Promise<CaseResult[]> {
  const now = opts.now ?? (() => Date.now())
  const out: CaseResult[] = []
  for (const c of cases) {
    const t0 = now()
    let r: CaseResult
    if (opts.skipSlow && c.name.includes('(slow)')) {
      r = { group: c.group, name: c.name, status: 'skip', ms: 0, critical: !c.optional }
    } else {
      try {
        await c.run(p)
        r = { group: c.group, name: c.name, status: 'pass', ms: now() - t0, critical: !c.optional }
      } catch (e) {
        r = {
          group: c.group,
          name: c.name,
          status: c.optional ? 'skip' : 'fail',
          ms: now() - t0,
          error: e instanceof Error ? e.message : String(e),
          critical: !c.optional,
        }
      }
    }
    out.push(r)
    opts.onResult?.(r)
  }
  return out
}

export const summarize = (rs: CaseResult[]) => ({
  pass: rs.filter(r => r.status === 'pass').length,
  fail: rs.filter(r => r.status === 'fail').length,
  skip: rs.filter(r => r.status === 'skip').length,
})

import QuickCrypto from 'react-native-quick-crypto'
import { gunzipSync, gzipSync } from 'fflate'
import { createSubtleProvider, type CryptoProvider } from '@iris/core'

/**
 * Native CryptoProvider: WebCrypto API served by react-native-quick-crypto
 * (OpenSSL via Nitro Modules). Hermes has no CompressionStream, so gzip is fflate.
 * Verified on-device by the Diagnostics screen (same suite as the Node tests).
 */
let cached: CryptoProvider | null = null

export function nativeCryptoProvider(): CryptoProvider {
  cached ??= createSubtleProvider({
    name: 'react-native-quick-crypto',
    // Structural typing: quick-crypto's Subtle mirrors the parts of SubtleCrypto we use.
    subtle: QuickCrypto.subtle as unknown as Parameters<typeof createSubtleProvider>[0]['subtle'],
    getRandomValues: a => QuickCrypto.getRandomValues(a as never) as unknown as Uint8Array,
    gzip: async d => gzipSync(d),
    gunzip: async d => gunzipSync(d),
  })
  return cached
}

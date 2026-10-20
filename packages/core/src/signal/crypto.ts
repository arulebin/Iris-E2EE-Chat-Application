import { setWebCrypto } from '@privacyresearch/libsignal-protocol-typescript'
import { createLibsignalWebCrypto } from '../crypto/libsignalWebCrypto.ts'
import { getPlatform } from '../platform.ts'

/**
 * Point libsignal at the platform CryptoProvider instead of a global `crypto.subtle`.
 * Not needed on the web (the browser global is used as before); React Native and
 * Node-without-webcrypto call this once after configureCore().
 */
export function installLibsignalCrypto(): void {
  setWebCrypto(createLibsignalWebCrypto(getPlatform().crypto) as unknown as Crypto)
}

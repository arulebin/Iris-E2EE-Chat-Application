import './lib/corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  newSalt,
  deriveCredentials,
  ensureKeyPair,
  markUpgraded,
  fetchAuthSalt,
  upgradeLegacyAccount,
  fetchPublicKey,
  encryptMessage,
  decryptMessage,
  toBase64,
  fromBase64,
  wrapWithMaster,
  unwrapWithMaster,
  signWithLegacyKey,
  verifyLegacySignature,
  MEDIA_CRYPTO_OVERHEAD,
  encryptMediaBytes,
  decryptMediaBytes,
} from '@iris/core'
export type {
  Credentials,
  AuthSaltInfo,
  EncryptedMessage,
} from '@iris/core'

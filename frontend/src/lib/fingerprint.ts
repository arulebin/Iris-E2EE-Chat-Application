import './corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  keyFingerprint,
  identitySafetyNumber,
  computeSafetyNumber,
  formatSafetyNumber,
  fetchPublicJwk,
  loadOwnPublicJwk,
  subscribeTrust,
  getTrust,
  checkPin,
  acknowledgeKeyChange,
  setVerified,
  isSendBlocked,
  fetchPinnedPublicKey,
  identityFingerprint,
  resolveContactKeys,
  noteIdentitySeen,
  loadSafetyNumber,
} from '@iris/core'
export type {
  PinKind,
  ContactTrust,
  ContactKeys,
  SafetyNumber,
} from '@iris/core'

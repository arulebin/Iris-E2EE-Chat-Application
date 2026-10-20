import '../corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  NotV2Error,
  IdentityMismatchError,
  pad,
  unpad,
  wasV2Seen,
  bundleToDevice,
  startSession,
  encryptForDevice,
  decryptFromDevice,
  forgetSession,
  encryptFanout,
} from '@iris/core'
export type {
  WireEnvelope,
} from '@iris/core'

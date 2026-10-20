import '../corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  ab,
  b64,
  needsPasswordError,
  generateSignedPreKey,
  generatePreKeys,
  maintainPreKeys,
  initSignal,
} from '@iris/core'
export type {
  SignalContext,
} from '@iris/core'

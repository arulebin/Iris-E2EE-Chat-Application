import './corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  verifyPassword,
  signUp,
  logIn,
  unlockKeyMaterial,
} from '@iris/core'
export type {
  Session,
} from '@iris/core'

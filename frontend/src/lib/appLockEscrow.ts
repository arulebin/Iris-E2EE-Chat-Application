import './corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  ESCROW_INFO,
  ESCROW_SLOT,
  EscrowWrongPasswordError,
  EscrowRateLimitedError,
  EscrowMissingError,
  sealEscrow,
  openEscrow,
  deriveEscrowMaster,
  storeEscrow,
  loadEscrow,
  removeEscrow,
  escrowTags,
  escrowStatus,
  writeEscrows,
  openEscrows,
  FREE_ATTEMPTS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffAfter,
  escrowRetryIn,
  recordEscrowFailure,
  recordEscrowSuccess,
  setEscrowSessionMaster,
  getEscrowSessionMaster,
} from '@iris/core'
export type {
  EscrowBlob,
  EscrowStatus,
} from '@iris/core'

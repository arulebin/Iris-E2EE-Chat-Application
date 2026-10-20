import './corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  formatRecoveryKey,
  importRecoveryKey,
  parseRecoveryKey,
  BackupKeyChangedError,
  sealBackup,
  openBackup,
  fetchBackupMeta,
  isBackupEnabled,
  lastBackupAt,
  enableBackup,
  backupNow,
  restoreBackup,
  disableBackup,
  maybeAutoBackup,
  isRestoreDismissed,
  dismissRestore,
} from '@iris/core'
export type {
  BackupPayload,
  BackupMeta,
} from '@iris/core'

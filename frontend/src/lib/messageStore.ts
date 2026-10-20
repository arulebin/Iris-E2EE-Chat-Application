import './corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  HistoryStore,
  getMessages,
  upsertMessage,
  upsertMany,
  patchMessage,
  exportAll,
  importAll,
  isEmpty,
  getLegacyCache,
  setLegacyCache,
  migrateHistory,
  hasMessage,
  mergeHistory,
} from '@iris/core'

import '../corePlatform'
// Implementation lives in @iris/core; this file keeps the existing import path.
export {
  GROUP_PEER_PREFIX,
  groupPeer,
  isGroupPeer,
  groupIdOfPeer,
  encodeGroupPayload,
  decodeGroupPayload,
  describeEvent,
  eventsAsMessages,
  mergeTimeline,
  readByAllAt,
} from '@iris/core'

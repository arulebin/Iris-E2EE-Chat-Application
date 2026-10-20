import type { Services } from '../services'
import { Runtime } from './runtime'

export { Runtime } from './runtime'

let instance: Runtime | null = null

/**
 * The process-wide runtime (created on first use; boots the stored session in the background). `headless`
 * only matters for the first call: a runtime created by a push / notification action stays off the socket
 * until the app is foregrounded.
 */
export function getRuntime(opts: { headless?: boolean } = {}): Runtime {
  instance ??= new Runtime(opts)
  return instance
}

/** The runtime if the real stack is in use (null under EXPO_PUBLIC_MOCK=1), without creating it. */
export function peekRuntime(): Runtime | null {
  return instance
}

/** The real Services, backed by @iris/core + the platform adapters. */
export function createRealServices(rt: Runtime = getRuntime()): Services {
  return {
    events: rt.events,
    auth: {
      getSession: () => rt.getSession(),
      login: (u, p) => rt.login(u, p),
      signup: (u, p) => rt.signup(u, p),
      isUsernameAvailable: u => rt.isUsernameAvailable(u),
      logout: () => rt.logout(),
      lock: () => rt.lock(),
      unlock: p => rt.unlockWithPassword(p),
      unlockWithBiometrics: () => rt.unlockWithBiometrics(),
    },
    contacts: {
      list: () => rt.listContacts(),
      get: id => rt.getContact(id),
      requests: () => rt.requests(),
      acceptRequest: id => rt.acceptRequest(id),
      declineRequest: id => rt.declineRequest(id),
      add: c => rt.addContact(c),
      block: id => rt.block(id),
      unblock: id => rt.unblock(id),
      blocked: () => rt.blocked(),
    },
    chats: {
      list: () => rt.listChats(),
      get: id => rt.getChat(id),
      messages: (id, o) => rt.messages(id, o),
      send: (id, t, r) => rt.send(id, t, r),
      retry: (id, m) => rt.retry(id, m),
      setTyping: (id, t) => rt.setTyping(id, t),
      markRead: id => rt.markRead(id),
      deleteForMe: (id, m) => rt.deleteForMe(id, m),
      openDirect: id => rt.openDirect(id),
      setPinned: (id, v) => rt.setChatPref(id, 'pinned', v),
      setMuted: (id, v) => rt.setChatPref(id, 'muted', v),
      setArchived: (id, v) => rt.setChatPref(id, 'archived', v),
      refresh: () => rt.refreshAll(),
    },
    profile: { get: () => rt.getProfile(), update: p => rt.updateProfile(p) },
    privacy: {
      get: () => rt.getPrivacy(),
      setPrivateProfile: async v => rt.updatePrivacy({ privateProfile: v }),
      setAllowInvites: async v => rt.updatePrivacy({ invitesEnabled: v }),
      rotateInvite: () => rt.rotateInvite(),
    },
    groups: {
      create: (n, m) => rt.createGroup(n, m),
      get: id => rt.getGroup(id),
      rename: (id, n) => rt.renameGroup(id, n),
      resetInvite: id => rt.resetGroupInvite(id),
      leave: id => rt.leaveGroup(id),
    },
    safety: { get: id => rt.safety(id), setVerified: (id, v) => rt.setVerified(id, v) },
    backup: {
      status: () => rt.backupStatus(),
      enable: () => rt.enableBackup(),
      disable: () => rt.disableBackup(),
      backupNow: () => rt.backupNow(),
      restore: k => rt.restore(k),
    },
    devices: { list: () => rt.devices(), revoke: id => rt.revokeDevice(id) },
    settings: {
      get: async () => rt.getPrefs(),
      update: p => rt.updatePrefs(p),
    },
  }
}

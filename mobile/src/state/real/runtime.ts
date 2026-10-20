import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { AppState } from 'react-native'
import { createMMKV } from 'react-native-mmkv'
import {
  acknowledgeKeyChange,
  backupNow as coreBackupNow,
  configureCore,
  createMutex,
  deleteMessages,
  disableBackup,
  enableBackup,
  ensureKeyPair,
  fetchBackupMeta,
  formatInviteCode,
  getMessages,
  getTrust,
  getUsername,
  groupApi,
  groupPeer,
  initSignal,
  isBackupEnabled,
  isSendBlocked,
  lastBackupAt,
  loadSafetyNumber,
  logIn,
  maybeAutoBackup,
  normalizeInviteCode,
  noteIdentitySeen,
  patchMessage,
  resolveContactKeys,
  restoreBackup,
  setVerified as coreSetVerified,
  signalApi,
  signUp,
  SignalClient,
  unlockKeyMaterial,
  verifyPassword,
  type ChatMessage,
  type GroupDto,
  type MasterKey,
  type SendExtras,
  type SignalContext,
  type SyncStore,
  type UserProfile,
  type V2Meta,
} from '@iris/core'
import { configureCalls, attachCallTransport, decodeSignal, getCallEngine, isCallsConfigured, type CallSignal, type CallSignalingTransport } from '@/calls'
import { configureMedia, registerMediaSendHandler, screenSecurity, setScreenSecurityAdapter, type OutgoingMedia } from '@/media'
import { IrisKeystore } from '../../../modules/iris-keystore/src'
import { nativeCryptoProvider } from '../../crypto/provider'
import { API_BASE_URL, createPlatform, setScreenSecure, type Platform } from '../../platform'
import { createKeystoreWrapper, KeystoreKeyMissingError } from '../../platform/keystore'
import { installLibsignal } from '../../platform/libsignal'
import { AuthError, ServiceError } from '../services'
import type {
  AppSettings, BackupStatus, ChatSummary, Contact, DeviceInfo, FriendRequest, GroupDetail, GroupMember, Message,
  PrivacyState, SafetyInfo, ServiceEvents, Session, Topic,
} from '../services'
import { digitsOfQr, displayName, messageKey, previewText, toContact, toUiMessage } from './mapping'

const PROD_HOST_HINT = API_BASE_URL

// ── tiny helpers ───────────────────────────────────────────────────────

function createBus(): ServiceEvents {
  const map = new Map<string, Set<() => void>>()
  return {
    on(topic, fn) {
      let s = map.get(topic)
      if (!s) map.set(topic, (s = new Set()))
      s.add(fn)
      return () => s!.delete(fn)
    },
    emit(topic) {
      for (const fn of [...(map.get(topic) ?? [])]) {
        try {
          fn()
        } catch (e) {
          console.warn('[events]', topic, e)
        }
      }
    },
  }
}

const mmkvSync = (id: string): SyncStore => {
  const m = createMMKV({ id })
  return { getItem: k => m.getString(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => void m.remove(k) }
}

const isNetworkError = (e: unknown) => e instanceof TypeError || /network request failed|failed to fetch|timeout|not connected/i.test(String((e as Error)?.message ?? e))

const DEFAULT_PREFS: AppSettings = { theme: 'system', screenSecurity: true, appLock: false, haptics: true, notifications: true }

type ChatPrefs = Record<string, { pinned?: boolean; muted?: boolean; archived?: boolean }>

/** Everything that exists only while an account is open. */
interface Acct {
  me: string
  platform: Platform
  master: MasterKey | null
  ctx: SignalContext | null
  client: SignalClient | null
  socket: (ReturnType<Platform['transport']['connect']>) | null
  needsPassword: boolean
  /** Bumped on logout so late async work from this account is ignored. */
  gen: number
  users: UserProfile[]
  groups: GroupDto[]
  blocked: string[]
  presence: Map<string, boolean>
  peerReadAt: Map<string, number>
  typing: Map<string, ReturnType<typeof setTimeout>>
  typingSet: Set<string>
  unread: Record<string, number>
  chatPrefs: ChatPrefs
  lastCache: Map<string, ChatMessage | null>
  pending: Map<string, Message[]>
  profile?: UserProfile
  bio: string
}

/**
 * The real data layer: @iris/core + createPlatform() behind the Services interfaces. One instance per
 * process; at most one account open at a time (core's platform seams are process-global, like the web app).
 */
export class Runtime {
  readonly events: ServiceEvents = createBus()
  private acct: Acct | null = null
  private prefsStore = createMMKV({ id: 'iris-prefs' })
  private flags = mmkvSync('iris-flags')
  private locks = createMutex()
  private booted: Promise<void>
  private ready = false
  private openChat: string | null = null
  private signalListeners = new Set<(s: CallSignal) => void>()
  private openListeners = new Set<() => void>()
  private appLockLocked = false
  private backgroundAt = 0
  private lockSuppressedUntil = 0
  private nativeInstalled = false

  constructor() {
    this.booted = this.boot().catch(e => {
      console.warn('[runtime] boot failed', e)
    })
    AppState.addEventListener('change', s => this.onAppState(s))
  }

  // ── preferences ─────────────────────────────────────────────────────

  getPrefs(): AppSettings {
    try {
      const raw = this.prefsStore.getString('settings')
      return { ...DEFAULT_PREFS, ...(raw ? (JSON.parse(raw) as Partial<AppSettings>) : {}) }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }

  private savePrefs(p: AppSettings) {
    this.prefsStore.set('settings', JSON.stringify(p))
  }

  async updatePrefs(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...this.getPrefs(), ...patch }
    // App lock first: turning it on can fail (no screen lock, cancelled prompt) and must then not be saved.
    if (patch.appLock !== undefined && patch.appLock !== this.getPrefs().appLock) await this.setAppLock(next.appLock)
    this.savePrefs(next)
    if (patch.screenSecurity !== undefined) await setScreenSecure(next.screenSecurity).catch(() => {})
    if (patch.notifications !== undefined && this.acct) {
      if (next.notifications) void this.enablePush()
      else void this.acct.platform.push.disable().catch(() => {})
    }
    this.events.emit('settings')
    return next
  }

  // ── app lock (OFF by default) ───────────────────────────────────────

  /** Call before leaving the app on purpose (system pickers, permission dialogs) so returning does not lock. */
  suppressLock(ms = 120_000) {
    this.lockSuppressedUntil = Date.now() + ms
  }

  private async setAppLock(on: boolean) {
    const a = this.acct
    if (!a) return
    if (on) {
      const st = await a.platform.appLock.status()
      if (st !== 'available') {
        throw new ServiceError('network', st === 'none_enrolled' ? 'Set up a screen lock or fingerprint in Android settings first' : 'This device does not support app lock')
      }
      await a.platform.appLock.createKey(20)
      await a.platform.appLock.authenticate('Turn on app lock')
    } else {
      await a.platform.appLock.deleteKey().catch(() => {})
      this.appLockLocked = false
    }
  }

  private onAppState(s: string) {
    const a = this.acct
    if (s === 'background' || s === 'inactive') {
      if (s === 'background') this.backgroundAt = Date.now()
    }
    if (a?.socket?.isOpen) {
      try {
        a.socket.send(JSON.stringify({ type: 'visibility', state: s === 'active' ? 'visible' : 'hidden' }))
      } catch { /* socket closing */ }
    }
    if (s === 'active') {
      if (this.openChat && a) this.sendRead(this.openChat)
      const callBusy = isCallsConfigured() && getCallEngine().getSnapshot().state.kind !== 'idle'
      const wantsLock = this.getPrefs().appLock && this.backgroundAt > 0 && Date.now() - this.backgroundAt > 20_000
      if (a && wantsLock && !callBusy && Date.now() > this.lockSuppressedUntil && !this.appLockLocked) {
        this.appLockLocked = true
        this.events.emit('session')
      }
      this.backgroundAt = 0
    }
    if (s === 'background' && a?.ctx) void this.token().then(t => maybeAutoBackup(a.me, t)).catch(() => {})
  }

  // ── boot / session ──────────────────────────────────────────────────

  private async boot() {
    this.installNative()
    await setScreenSecure(this.getPrefs().screenSecurity).catch(() => {})
    const last = this.prefsStore.getString('lastUser')
    if (last) {
      try {
        const a = await this.openAccount(last)
        const refresh = await a.platform.tokens.getRefresh()
        if (!refresh) {
          await this.closeAccount(false)
        } else {
          this.appLockLocked = this.getPrefs().appLock
          if (!this.appLockLocked) void this.activate(a)
        }
      } catch (e) {
        console.warn('[runtime] restore failed', e)
        await this.closeAccount(false)
        if (e instanceof KeystoreKeyMissingError) this.prefsStore.remove('lastUser')
      }
    }
    this.ready = true
    this.events.emit('session')
  }

  /** One-time process wiring: libsignal curve, media + calls adapters. */
  private installNative() {
    if (this.nativeInstalled) return
    this.nativeInstalled = true
    installLibsignal(nativeCryptoProvider())
    setScreenSecurityAdapter({
      acquire: () => setScreenSecure(true),
      release: () => setScreenSecure(this.getPrefs().screenSecurity),
    })
    configureMedia({
      apiBase: API_BASE_URL,
      getToken: async () => (await this.acct?.platform.tokens.getAccess()) ?? '',
      refreshToken: async () => {
        await this.acct?.platform.transport.fetch.refresh()
      },
    })
    registerMediaSendHandler(items => this.onOutgoingMedia(items))
    configureCalls({
      apiBase: API_BASE_URL,
      getToken: async () => (await this.acct?.platform.tokens.getAccess()) ?? null,
      screenSecurity: { acquire: () => screenSecurity.acquire() },
      nameOf: u => this.nameOf(u),
      onAccepted: peer => this.events.emit(`messages:${peer}` as Topic),
    })
    attachCallTransport(this.callTransport)
  }

  private callTransport: CallSignalingTransport = {
    send: signal => {
      const s = this.acct?.socket
      if (!s?.isOpen) return false
      try {
        s.send(JSON.stringify(signal))
        return true
      } catch {
        return false
      }
    },
    isOpen: () => !!this.acct?.socket?.isOpen,
    onSignal: cb => {
      this.signalListeners.add(cb)
      return () => this.signalListeners.delete(cb)
    },
    onOpen: cb => {
      this.openListeners.add(cb)
      return () => this.openListeners.delete(cb)
    },
  }

  nameOf = (username: string): string => {
    const u = this.acct?.users.find(x => x.username === username)
    return u ? displayName(u) : username
  }

  private async openAccount(username: string): Promise<Acct> {
    if (this.acct && this.acct.me === username) return this.acct
    await this.closeAccount(false)
    const holder: { a?: Acct } = {}
    const platform = await createPlatform({
      alias: username,
      getDeviceId: () => holder.a?.ctx?.deviceId ?? null,
      onSignedOut: () => void this.onSessionEnded(holder.a),
    })
    const p = platform
    configureCore({
      crypto: nativeCryptoProvider(),
      apiBase: '',
      apiFetch: (url, init) => p.transport.fetch(url, init),
      fetch: (url, init) => fetch(API_BASE_URL + url, init),
      setSession: (t, r) => void p.tokens.set(t, r ?? ''),
      kv: p.kv,
      flags: this.flags,
      getLocks: () => this.locks,
      keyWrapperFor: alias => (IrisKeystore ? createKeystoreWrapper(`iris-${alias}`, IrisKeystore) : null),
      deviceLabel: () => `${Device.modelName ?? 'Phone'} (Iris Android)`,
    })
    const unread = (await p.kv.get<Record<string, number>>(`rt:unread:${username}`)) ?? {}
    const chatPrefs = (await p.kv.get<ChatPrefs>(`rt:chatprefs:${username}`)) ?? {}
    const users = (await p.kv.get<UserProfile[]>(`rt:users:${username}`)) ?? []
    const bio = (await p.kv.get<string>(`rt:bio:${username}`)) ?? ''
    const a: Acct = {
      me: username, platform, master: null, ctx: null, client: null, socket: null, needsPassword: false, gen: Date.now(),
      users, groups: [], blocked: [], presence: new Map(), peerReadAt: new Map(), typing: new Map(), typingSet: new Set(),
      unread, chatPrefs, lastCache: new Map(), pending: new Map(), bio,
    }
    holder.a = a
    this.acct = a
    return a
  }

  /** Local teardown. `wipeTokens` also forgets the login (logout / expired session). */
  private async closeAccount(wipeTokens: boolean) {
    const a = this.acct
    if (!a) return
    this.acct = null
    a.gen = -1
    a.client?.dispose()
    a.socket?.close()
    a.typing.forEach(t => clearTimeout(t))
    attachCallTransport(this.callTransport)
    if (wipeTokens) await a.platform.tokens.clear().catch(() => {})
  }

  private async onSessionEnded(a: Acct | undefined) {
    if (!a || this.acct !== a) return
    await this.closeAccount(true)
    this.prefsStore.remove('lastUser')
    this.events.emit('session')
  }

  /** Bring the open account up: legacy key (best effort), Signal device, socket, push, adapters. */
  private async activate(a: Acct): Promise<void> {
    const gen = a.gen
    const token = (await a.platform.tokens.getAccess()) ?? ''
    try {
      await Promise.race([
        ensureKeyPair(a.me, a.master, token),
        new Promise((_, rej) => setTimeout(() => rej(new Error('legacy key setup timed out')), 30_000)),
      ])
    } catch (e) {
      if (/Password required/.test(String((e as Error)?.message))) {
        a.needsPassword = true
        this.events.emit('session')
        return
      }
      console.warn('[runtime] legacy key setup skipped:', (e as Error)?.message)
    }
    try {
      const ctx = await initSignal(a.me, a.master, token, a.platform.kv)
      if (a.gen !== gen) return
      ctx.store.onIdentity((contact, key) => noteIdentitySeen(a.me, contact, key, token).catch(e => console.warn('pin check failed', e)))
      a.ctx = ctx
      a.client?.dispose()
      a.client = new SignalClient(ctx, token, () => this.socketLike(a))
      a.needsPassword = false
      this.events.emit('session')
    } catch (e) {
      if (/Password required/.test(String((e as Error)?.message))) {
        a.needsPassword = true
        this.events.emit('session')
        return
      }
      console.warn('[runtime] secure messaging setup failed', e)
      return
    }
    void this.refreshContacts().catch(() => {})
    void this.refreshGroups().catch(() => {})
    this.connect(a)
    void this.enablePush()
    void maybeAutoBackup(a.me, token).catch(() => {})
    void this.offerRestore(a, token)
  }

  private restoreOffered = false
  private async offerRestore(a: Acct, token: string) {
    if (!a.ctx?.freshDevice || this.restoreOffered) return
    this.restoreOffered = true
    // A new device with a server backup: the Backup screen carries the restore flow; nudge the status.
    try {
      const meta = await fetchBackupMeta(token)
      if (meta.exists) this.events.emit('backup')
    } catch { /* offline */ }
  }

  private socketLike(a: Acct) {
    return {
      get readyState() {
        return a.socket?.isOpen ? 1 : 0
      },
      send: (d: string) => a.socket!.send(d),
    }
  }

  private async enablePush() {
    const a = this.acct
    if (!a || !this.getPrefs().notifications) return
    try {
      await a.platform.push.enable()
      a.platform.push.watchRotation()
    } catch (e) {
      console.warn('[runtime] push registration skipped:', (e as Error)?.message)
    }
  }

  // ── realtime ────────────────────────────────────────────────────────

  private connect(a: Acct) {
    a.socket?.close()
    a.socket = a.platform.transport.connect({
      onOpen: () => {
        const s = a.socket
        if (!s || this.acct !== a) return
        try {
          s.send(JSON.stringify({ type: 'visibility', state: AppState.currentState === 'active' ? 'visible' : 'hidden' }))
          s.send(JSON.stringify({ type: 'sync' }))
          for (const u of a.users) s.send(JSON.stringify({ type: 'presence-query', user: u.username }))
        } catch { /* closed again */ }
        this.openListeners.forEach(cb => cb())
        this.events.emit('chats')
      },
      onMessage: frame => void this.onFrame(a, frame),
      onClose: () => this.events.emit('chats'),
    })
  }

  private sendFrame(obj: unknown): boolean {
    const s = this.acct?.socket
    if (!s?.isOpen) return false
    try {
      s.send(JSON.stringify(obj))
      return true
    } catch {
      return false
    }
  }

  private async onFrame(a: Acct, frame: string) {
    if (this.acct !== a) return
    const sig = decodeSignal(frame)
    if (sig) {
      this.signalListeners.forEach(cb => cb(sig))
      return
    }
    let data: Record<string, unknown> & { type?: string }
    try {
      data = JSON.parse(frame)
    } catch {
      return
    }
    try {
      if (a.client?.handleReply(data as { type?: string; clientId?: string })) return
      switch (data.type) {
        case 'device-revoked':
          await this.onDeviceRevoked(a)
          return
        case 'groups-changed':
          void this.refreshGroups()
          return
        case 'friends-changed':
          void this.refreshContacts()
          return
        case 'presence': {
          a.presence.set(String(data.user), !!data.online)
          this.events.emit('contacts')
          this.events.emit('chats')
          return
        }
        case 'typing': {
          const key = data.group ? String(data.group) : String(data.from)
          if (data.state === 'stop') this.setPeerTyping(a, key, false)
          else this.setPeerTyping(a, key, true)
          return
        }
        case 'read-receipt': {
          a.peerReadAt.set(String(data.by), Date.now())
          this.events.emit(`messages:${String(data.by)}` as Topic)
          return
        }
        case 'envelope': {
          await this.onEnvelope(a, data as unknown as { envType: number; body: string; envelopeId: number; message: V2Meta })
          return
        }
        default:
          return
      }
    } catch (e) {
      console.warn('[runtime] frame failed', data.type, e)
    }
  }

  private setPeerTyping(a: Acct, key: string, on: boolean) {
    const prev = a.typing.get(key)
    if (prev) clearTimeout(prev)
    if (on) {
      a.typingSet.add(key)
      a.typing.set(key, setTimeout(() => this.setPeerTyping(a, key, false), 6000))
    } else {
      a.typingSet.delete(key)
      a.typing.delete(key)
    }
    this.events.emit(`typing:${key}` as Topic)
    this.events.emit('chats')
  }

  private async onEnvelope(a: Acct, data: { envType: number; body: string; envelopeId: number; message: V2Meta }) {
    const client = a.client
    if (!client) return // not acked: redelivered by the next sync
    const { peer, message } = await client.open(data)
    // Persisted before the ack, so a crash cannot lose a forward-secret message.
    this.sendFrame({ type: 'ack', ids: [data.envelopeId] })
    const chatId = peer.startsWith('group:') ? peer.slice(6) : peer
    a.lastCache.set(chatId, message)
    if (message.from !== a.me) {
      const looking = this.openChat === chatId && AppState.currentState === 'active'
      if (looking) this.sendRead(chatId)
      else this.bumpUnread(a, chatId)
      this.setPeerTyping(a, peer.startsWith('group:') ? chatId : message.from, false)
    }
    this.events.emit(`messages:${chatId}` as Topic)
    this.events.emit('chats')
  }

  private bumpUnread(a: Acct, chatId: string, by = 1) {
    a.unread[chatId] = (a.unread[chatId] ?? 0) + by
    void a.platform.kv.set(`rt:unread:${a.me}`, a.unread)
  }

  private sendRead(chatId: string) {
    const a = this.acct
    if (!a) return
    const isGroup = a.groups.some(g => g.id === chatId)
    this.sendFrame(isGroup ? { type: 'read', group: chatId } : { type: 'read', from: chatId })
  }

  private async onDeviceRevoked(a: Acct) {
    a.client?.dispose()
    await a.ctx?.store.wipe().catch(() => {})
    a.client = null
    a.ctx = null
    a.master = null
    a.needsPassword = true
    a.socket?.close()
    a.socket = null
    this.events.emit('session')
  }

  // ── auth ────────────────────────────────────────────────────────────

  private sessionOf(a: Acct): Session {
    return {
      userId: a.me,
      username: a.me,
      displayName: a.profile ? displayName(a.profile) : a.me,
      locked: this.appLockLocked || a.needsPassword,
    }
  }

  async getSession(): Promise<Session | null> {
    await this.booted
    return this.acct ? this.sessionOf(this.acct) : null
  }

  async login(username: string, password: string): Promise<Session> {
    await this.booted
    username = username.trim()
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new AuthError('bad-credentials')
    await this.closeAccount(false)
    const a = await this.openAccount(username)
    try {
      const s = await logIn(username, password)
      a.master = s.master
    } catch (e) {
      await this.closeAccount(true)
      throw this.authError(e, 'bad-credentials')
    }
    return this.afterAuth(a)
  }

  async signup(username: string, password: string): Promise<Session> {
    await this.booted
    username = username.trim()
    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new AuthError('invalid-username')
    await this.closeAccount(false)
    const a = await this.openAccount(username)
    try {
      const s = await signUp(username, password)
      a.master = s.master
    } catch (e) {
      await this.closeAccount(true)
      throw this.authError(e, 'bad-credentials')
    }
    return this.afterAuth(a)
  }

  private authError(e: unknown, fallback: 'bad-credentials'): AuthError {
    if (isNetworkError(e)) return new AuthError('network')
    const msg = String((e as Error)?.message ?? '')
    if (/taken|already|exist|conflict|409/i.test(msg)) return new AuthError('username-taken', msg)
    if (/username/i.test(msg) && /invalid|3|32/i.test(msg)) return new AuthError('invalid-username', msg)
    return new AuthError(fallback, msg)
  }

  private async afterAuth(a: Acct): Promise<Session> {
    this.prefsStore.set('lastUser', a.me)
    this.appLockLocked = false
    this.restoreOffered = false
    await this.activate(a)
    const p = await this.apiJson<UserProfile>(`/api/users/${encodeURIComponent(a.me)}`).catch(() => undefined)
    if (p) a.profile = p
    this.events.emit('session')
    return this.sessionOf(a)
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    // The server answers /auth/salt for unknown users with a fake salt (no enumeration): availability is only
    // decided at signup.
    return /^[A-Za-z0-9_]{3,32}$/.test(username.trim())
  }

  async logout(): Promise<void> {
    const a = this.acct
    if (!a) return
    await a.platform.push.disable().catch(() => {})
    const refresh = await a.platform.tokens.getRefresh().catch(() => null)
    if (refresh) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      }).catch(() => {})
    }
    await this.closeAccount(true)
    this.prefsStore.remove('lastUser')
    this.appLockLocked = false
    this.events.emit('session')
  }

  async lock(): Promise<void> {
    this.appLockLocked = true
    this.events.emit('session')
  }

  /** Password unlock: re-derives the key-unlock secret (needed when local keys were lost) and clears any lock. */
  async unlockWithPassword(password: string): Promise<Session> {
    const a = this.acct
    if (!a) throw new AuthError('bad-credentials')
    try {
      const token = (await a.platform.tokens.getAccess()) ?? ''
      a.master = a.needsPassword || !a.ctx ? await unlockKeyMaterial(a.me, password, token) : await verifyPassword(a.me, password)
    } catch (e) {
      throw isNetworkError(e) ? new AuthError('network') : new AuthError('bad-password')
    }
    this.appLockLocked = false
    if (!a.ctx) await this.activate(a)
    this.events.emit('session')
    return this.sessionOf(a)
  }

  async unlockWithBiometrics(): Promise<Session> {
    const a = this.acct
    if (!a) throw new AuthError('bad-credentials')
    await a.platform.appLock.authenticate('Unlock Iris')
    this.appLockLocked = false
    if (!a.ctx && !a.needsPassword) await this.activate(a)
    this.events.emit('session')
    return this.sessionOf(a)
  }

  // ── http ────────────────────────────────────────────────────────────

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const a = this.need()
    return a.platform.transport.fetch(path, init)
  }

  private async apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, ...rest } = init
    const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) }
    if (json !== undefined) headers['Content-Type'] = 'application/json'
    const res = await this.api(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw Object.assign(new Error(text || `Request failed (${res.status})`), { status: res.status })
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private need(): Acct {
    if (!this.acct) throw new ServiceError('network', 'Not signed in')
    return this.acct
  }

  private async token(): Promise<string> {
    return (await this.need().platform.tokens.getAccess()) ?? ''
  }

  // ── contacts ────────────────────────────────────────────────────────

  async refreshContacts(): Promise<void> {
    const a = this.need()
    const [users, blocked] = await Promise.all([
      this.apiJson<UserProfile[]>('/api/users'),
      this.apiJson<{ username: string }[]>('/api/blocks').catch(() => []),
    ])
    a.users = users
    a.blocked = blocked.map(b => b.username)
    void a.platform.kv.set(`rt:users:${a.me}`, users)
    for (const u of users) this.sendFrame({ type: 'presence-query', user: u.username })
    this.events.emit('contacts')
    this.events.emit('requests')
    this.events.emit('chats')
  }

  private async contactOf(u: UserProfile): Promise<Contact> {
    const a = this.need()
    const trust = await getTrust(a.me, u.username).catch(() => undefined)
    return toContact(u, { online: a.presence.get(u.username), verified: !!trust?.verified && !trust.changed, blocked: a.blocked.includes(u.username) })
  }

  async listContacts(): Promise<Contact[]> {
    const a = this.need()
    return Promise.all(a.users.map(u => this.contactOf(u)))
  }

  async getContact(id: string): Promise<Contact | null> {
    const a = this.need()
    const u = a.users.find(x => x.username === id)
    if (u) return this.contactOf(u)
    try {
      const p = await this.apiJson<UserProfile>(`/api/users/${encodeURIComponent(id)}`)
      return toContact(p)
    } catch {
      return null
    }
  }

  async requests(): Promise<FriendRequest[]> {
    const rows = await this.apiJson<{ id: number; fromUser: string; createdAt: string }[]>('/api/friends/requests/incoming')
    return Promise.all(
      rows.map(async r => {
        const p = await this.apiJson<UserProfile>(`/api/users/${encodeURIComponent(r.fromUser)}`).catch(() => ({ username: r.fromUser }) as UserProfile)
        return { id: String(r.id), from: toContact(p), createdAt: Date.parse(r.createdAt) || Date.now() }
      }),
    )
  }

  async acceptRequest(id: string) {
    await this.apiJson(`/api/friends/requests/${id}/accept`, { method: 'PUT' })
    await this.refreshContacts()
  }

  async declineRequest(id: string) {
    await this.apiJson(`/api/friends/requests/${id}/reject`, { method: 'PUT' })
    this.events.emit('requests')
  }

  async addContact(codeOrUsername: string): Promise<Contact> {
    const input = codeOrUsername.trim()
    const code = normalizeInviteCode(input)
    let profile: UserProfile
    try {
      if (code) {
        profile = await this.apiJson<UserProfile>(`/api/users/by-invite/${encodeURIComponent(formatInviteCode(code))}`)
        await this.apiJson('/api/friends/request', { method: 'POST', json: { toInviteCode: formatInviteCode(code) } })
      } else {
        const found = await this.apiJson<UserProfile[]>(`/api/users/search?q=${encodeURIComponent(input.replace(/^@/, ''))}`)
        const hit = found.find(u => u.username.toLowerCase() === input.replace(/^@/, '').toLowerCase())
        if (!hit?.shareId) throw new ServiceError('not-found')
        profile = hit
        await this.apiJson('/api/friends/request', { method: 'POST', json: { toShareId: hit.shareId } })
      }
    } catch (e) {
      if (e instanceof ServiceError) throw e
      const status = (e as { status?: number }).status
      if (status === 404) throw new ServiceError(code ? 'invalid-code' : 'not-found')
      if (status === 409) throw new ServiceError('blocked')
      throw new ServiceError('network', (e as Error).message)
    }
    await this.refreshContacts().catch(() => {})
    return toContact(profile)
  }

  async block(id: string) {
    await this.apiJson(`/api/blocks/${encodeURIComponent(id)}`, { method: 'POST' })
    await this.refreshContacts()
  }

  async unblock(id: string) {
    await this.apiJson(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await this.refreshContacts()
  }

  async blocked(): Promise<Contact[]> {
    const a = this.need()
    const rows = await this.apiJson<{ username: string }[]>('/api/blocks')
    a.blocked = rows.map(r => r.username)
    return rows.map(r => toContact({ username: r.username }, { blocked: true }))
  }

  // ── chats ───────────────────────────────────────────────────────────

  private groupById(id: string) {
    return this.need().groups.find(g => g.id === id)
  }

  private peerKey(chatId: string): string {
    return this.groupById(chatId) ? groupPeer(chatId) : chatId
  }

  private async lastOf(chatId: string): Promise<ChatMessage | null> {
    const a = this.need()
    if (a.lastCache.has(chatId)) return a.lastCache.get(chatId) ?? null
    const list = await getMessages(a.me, this.peerKey(chatId)).catch(() => [] as ChatMessage[])
    const last = list.length ? list[list.length - 1] : null
    a.lastCache.set(chatId, last)
    return last
  }

  private summary(a: Acct, chatId: string, kind: 'direct' | 'group', title: string, last: ChatMessage | null, extra: Partial<ChatSummary> = {}): ChatSummary {
    const pr = a.chatPrefs[chatId] ?? {}
    return {
      id: chatId,
      kind,
      title,
      online: kind === 'direct' ? !!a.presence.get(chatId) : false,
      lastMessage: last
        ? { text: previewText(last), at: Date.parse(last.sentAt) || 0, fromMe: last.from === a.me, status: last.id == null ? 'sending' : 'sent', senderName: last.from === a.me ? 'You' : this.nameOf(last.from) }
        : undefined,
      unread: a.unread[chatId] ?? 0,
      pinned: !!pr.pinned,
      muted: !!pr.muted,
      archived: !!pr.archived,
      typing: a.typingSet.has(chatId),
      ...extra,
    }
  }

  async listChats(): Promise<ChatSummary[]> {
    const a = this.need()
    const out: ChatSummary[] = []
    for (const u of a.users) {
      out.push(this.summary(a, u.username, 'direct', displayName(u), await this.lastOf(u.username), { peerId: u.username }))
    }
    for (const g of a.groups) {
      out.push(this.summary(a, g.id, 'group', g.name, await this.lastOf(g.id), { memberCount: g.members.length }))
    }
    return out.sort((x, y) => (y.lastMessage?.at ?? 0) - (x.lastMessage?.at ?? 0))
  }

  async getChat(chatId: string): Promise<ChatSummary | null> {
    const a = this.need()
    const g = this.groupById(chatId)
    if (g) return this.summary(a, chatId, 'group', g.name, await this.lastOf(chatId), { memberCount: g.members.length })
    const u = a.users.find(x => x.username === chatId)
    if (!u) return null
    return this.summary(a, chatId, 'direct', displayName(u), await this.lastOf(chatId), { peerId: u.username })
  }

  setOpenChat(chatId: string | null) {
    this.openChat = chatId
    if (chatId) void this.refreshMeta(chatId)
  }

  /** Server-side metadata for my sent messages: when the peer read them, whether a view-once was opened. */
  private async refreshMeta(chatId: string) {
    const a = this.acct
    if (!a || this.groupById(chatId)) return
    try {
      const rows = await this.apiJson<ChatMessage[]>(`/api/messages?with=${encodeURIComponent(chatId)}`)
      const reads = rows.filter(m => m.from === a.me && m.readAt).map(m => Date.parse(m.readAt!))
      if (reads.length) a.peerReadAt.set(chatId, Math.max(...reads, a.peerReadAt.get(chatId) ?? 0))
      const viewed = rows.filter(m => m.viewedAt && m.id != null)
      for (const m of viewed) await patchMessage(a.me, chatId, x => x.id === m.id && !x.viewedAt, { viewedAt: m.viewedAt })
      this.events.emit(`messages:${chatId}` as Topic)
    } catch { /* offline */ }
  }

  async messages(chatId: string, opts: { before?: number; limit?: number } = {}): Promise<Message[]> {
    const a = this.need()
    const peer = this.peerKey(chatId)
    const hist = await getMessages(a.me, peer).catch(() => [] as ChatMessage[])
    const pending = a.pending.get(chatId) ?? []
    const byId = new Map(hist.filter(m => m.id != null).map(m => [m.id!, m]))
    const ctx = { me: a.me, peerReadAt: a.peerReadAt.get(chatId) ?? 0, nameOf: this.nameOf, byId: (id: number) => byId.get(id) }
    const confirmed = new Set(hist.map(m => m.clientId).filter(Boolean))
    const ui = [
      ...hist.map(m => toUiMessage(m, chatId, ctx)),
      ...pending.filter(m => !confirmed.has(m.id.replace(/^c:/, ''))),
    ].sort((x, y) => y.at - x.at)
    const before = opts.before ?? Infinity
    return ui.filter(m => m.at < before).slice(0, opts.limit ?? 80)
  }

  private addPending(chatId: string, m: Message) {
    const a = this.need()
    a.pending.set(chatId, [...(a.pending.get(chatId) ?? []), m])
    this.events.emit(`messages:${chatId}` as Topic)
  }

  private patchPending(chatId: string, id: string, patch: Partial<Message> | null) {
    const a = this.need()
    const list = (a.pending.get(chatId) ?? []).flatMap(m => (m.id !== id ? [m] : patch ? [{ ...m, ...patch }] : []))
    a.pending.set(chatId, list)
    this.events.emit(`messages:${chatId}` as Topic)
    this.events.emit('chats')
  }

  /** Encrypt + send one plaintext (text or media envelope) to a direct or group chat. */
  private async sendPlain(chatId: string, plaintext: string, extras: SendExtras): Promise<ChatMessage> {
    const a = this.need()
    const client = a.client
    if (!client) throw new ServiceError('network', 'Secure messaging is still starting. Try again in a moment.')
    const token = await this.token()
    const g = this.groupById(chatId)
    if (g) {
      const full = await groupApi.get(token, chatId).catch(() => g)
      const members = await Promise.all(
        full.members
          .filter(m => m.username !== a.me)
          .map(async m => {
            if (await isSendBlocked(a.me, m.username)) throw new Error(`${m.username}'s security key changed. Accept it before sending.`)
            const k = await resolveContactKeys(a.me, m.username, token).catch(() => null)
            return { user: m.username, identity: k?.identityKey ?? null }
          }),
      )
      return client.sendGroup(chatId, members, plaintext, extras)
    }
    if (await isSendBlocked(a.me, chatId)) throw new Error("This contact's security key changed. Accept it before sending.")
    const keys = await resolveContactKeys(a.me, chatId, token)
    if (!keys.identityKey) throw new Error(`${chatId} has not set up secure messaging yet`)
    return client.send(chatId, keys.identityKey, plaintext, extras)
  }

  async send(chatId: string, text: string, replyToId?: string): Promise<Message> {
    const a = this.need()
    const clientId = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const replyNum = replyToId && /^\d+$/.test(replyToId) ? Number(replyToId) : null
    const pendingMsg: Message = {
      id: `c:${clientId}`, chatId, senderId: a.me, senderName: 'You', fromMe: true, text, at: Date.now(), status: 'sending',
    }
    this.addPending(chatId, pendingMsg)
    this.typingStop(chatId)
    const attempt = async () => {
      const sent = await this.sendPlain(chatId, text, { replyToId: replyNum })
      a.lastCache.set(chatId, sent)
      this.patchPending(chatId, pendingMsg.id, null)
      return sent
    }
    this.retryHandlers.set(pendingMsg.id, attempt)
    try {
      const sent = await attempt()
      this.retryHandlers.delete(pendingMsg.id)
      this.events.emit(`messages:${chatId}` as Topic)
      return toUiMessage(sent, chatId, { me: a.me, peerReadAt: 0, nameOf: this.nameOf, byId: () => undefined })
    } catch (e) {
      this.patchPending(chatId, pendingMsg.id, { status: 'failed' })
      throw e
    }
  }

  private retryHandlers = new Map<string, () => Promise<unknown>>()

  async retry(chatId: string, messageId: string) {
    const h = this.retryHandlers.get(messageId)
    if (!h) return
    this.patchPending(chatId, messageId, { status: 'sending' })
    try {
      await h()
      this.retryHandlers.delete(messageId)
    } catch (e) {
      this.patchPending(chatId, messageId, { status: 'failed' })
      throw e
    }
  }

  setTyping(chatId: string, typing: boolean) {
    const g = this.groupById(chatId)
    this.sendFrame(g ? { type: 'typing', group: chatId, state: typing ? 'start' : 'stop' } : { type: 'typing', to: chatId, state: typing ? 'start' : 'stop' })
  }

  private typingStop(chatId: string) {
    this.setTyping(chatId, false)
  }

  async markRead(chatId: string) {
    const a = this.need()
    if ((a.unread[chatId] ?? 0) > 0) {
      a.unread[chatId] = 0
      void a.platform.kv.set(`rt:unread:${a.me}`, a.unread)
      this.events.emit('chats')
    }
    this.sendRead(chatId)
  }

  async deleteForMe(chatId: string, messageId: string) {
    const a = this.need()
    if (messageId.startsWith('c:')) {
      this.patchPending(chatId, messageId, null)
      return
    }
    await deleteMessages(a.me, this.peerKey(chatId), m => messageKey(m) === messageId)
    a.lastCache.delete(chatId)
    this.events.emit(`messages:${chatId}` as Topic)
    this.events.emit('chats')
  }

  async openDirect(contactId: string): Promise<string> {
    return contactId
  }

  async setChatPref(chatId: string, key: 'pinned' | 'muted' | 'archived', value: boolean) {
    const a = this.need()
    a.chatPrefs[chatId] = { ...a.chatPrefs[chatId], [key]: value }
    await a.platform.kv.set(`rt:chatprefs:${a.me}`, a.chatPrefs)
    this.events.emit('chats')
  }

  async refreshAll() {
    await Promise.all([this.refreshContacts(), this.refreshGroups()])
    this.sendFrame({ type: 'sync' })
  }

  // ── media ───────────────────────────────────────────────────────────

  /** Registered with media/session.ts: each outgoing item becomes a pending bubble, then a Signal message. */
  private async onOutgoingMedia(items: OutgoingMedia[]) {
    const a = this.need()
    for (const o of items) {
      const chatId = o.conversationId
      const id = `c:m${o.id}`
      this.addPending(chatId, {
        id, chatId, senderId: a.me, senderName: 'You', fromMe: true, text: o.caption, at: Date.now(), status: 'sending',
        media: { mediaId: '', key: '', mime: o.item.mime, caption: o.caption, viewOnce: o.viewOnce, viewed: false, pending: o },
      })
      const attempt = async () => {
        const up = await o.job.done()
        const sent = await this.sendPlain(chatId, o.job.envelope(o.caption), { mediaId: up.mediaId, mimeType: up.wireMimeType, viewOnce: o.viewOnce })
        a.lastCache.set(chatId, sent)
        o.job.dispose()
        this.patchPending(chatId, id, null)
      }
      this.retryHandlers.set(id, async () => {
        await o.job.retry()
        await attempt()
      })
      void attempt().catch(e => {
        console.warn('[runtime] media send failed', (e as Error)?.message)
        this.patchPending(chatId, id, { status: 'failed' })
      })
    }
  }

  async markViewed(chatId: string, key: string) {
    const a = this.need()
    await patchMessage(a.me, this.peerKey(chatId), m => messageKey(m) === key && !m.viewedAt, { viewedAt: new Date().toISOString() })
    this.events.emit(`messages:${chatId}` as Topic)
  }

  // ── profile / privacy ───────────────────────────────────────────────

  async getProfile() {
    const a = this.need()
    const p = await this.apiJson<UserProfile>(`/api/users/${encodeURIComponent(a.me)}`).catch(() => a.profile)
    if (p) a.profile = p
    return { username: a.me, displayName: p ? displayName(p) : a.me, bio: a.bio }
  }

  async updateProfile(patch: { displayName?: string; bio?: string }) {
    const a = this.need()
    if (patch.bio !== undefined) {
      a.bio = patch.bio
      await a.platform.kv.set(`rt:bio:${a.me}`, patch.bio)
    }
    if (patch.displayName !== undefined) {
      const p = await this.apiJson<UserProfile>('/api/users/profile', { method: 'PUT', json: { preferredName: patch.displayName, avatarUrl: a.profile?.avatarUrl } })
      a.profile = p
    }
    this.events.emit('profile')
    this.events.emit('session')
  }

  private privacyOf(p: { privateProfile: boolean; invitesEnabled: boolean; inviteCode: string | null }): PrivacyState {
    return {
      privateProfile: p.privateProfile,
      allowInvites: p.invitesEnabled,
      inviteCode: p.inviteCode ?? '',
      inviteUrl: p.inviteCode ? `${PROD_HOST_HINT}/?add=${encodeURIComponent(p.inviteCode)}` : '',
    }
  }

  async getPrivacy(): Promise<PrivacyState> {
    return this.privacyOf(await this.apiJson('/api/privacy'))
  }

  async updatePrivacy(patch: { privateProfile?: boolean; invitesEnabled?: boolean }) {
    await this.apiJson('/api/privacy', { method: 'PUT', json: patch })
    this.events.emit('privacy')
  }

  async rotateInvite(): Promise<PrivacyState> {
    const p = this.privacyOf(await this.apiJson('/api/privacy/invite/reset', { method: 'POST' }))
    this.events.emit('privacy')
    return p
  }

  // ── groups ──────────────────────────────────────────────────────────

  async refreshGroups() {
    const a = this.need()
    a.groups = await groupApi.mine(await this.token())
    this.events.emit('chats')
    for (const g of a.groups) this.events.emit(`group:${g.id}` as Topic)
  }

  async createGroup(name: string, memberIds: string[]): Promise<string> {
    const g = await groupApi.create(await this.token(), name, memberIds)
    await this.refreshGroups()
    return g.id
  }

  async getGroup(id: string): Promise<GroupDetail | null> {
    const a = this.need()
    let g: GroupDto
    try {
      g = await groupApi.get(await this.token(), id)
    } catch {
      return null
    }
    const mine = g.myRole === 'ADMIN' ? (g.createdBy === a.me ? 'owner' : 'admin') : 'member'
    const members: GroupMember[] = g.members.map(m => ({
      userId: m.username,
      displayName: m.preferredName?.trim() || m.username,
      username: m.username,
      role: m.username === g.createdBy ? 'owner' : m.role === 'ADMIN' ? 'admin' : 'member',
      online: !!a.presence.get(m.username),
      isMe: m.username === a.me,
    }))
    return {
      id: g.id,
      name: g.name,
      createdAt: Date.parse(g.createdAt) || 0,
      members,
      inviteLink: g.inviteToken ? `${PROD_HOST_HINT}/?group=${g.inviteToken}` : '',
      myRole: mine,
    }
  }

  async renameGroup(id: string, name: string) {
    await groupApi.update(await this.token(), id, { name })
    await this.refreshGroups()
  }

  async resetGroupInvite(id: string): Promise<string> {
    const g = await groupApi.resetInvite(await this.token(), id)
    this.events.emit(`group:${id}` as Topic)
    return g.inviteToken ? `${PROD_HOST_HINT}/?group=${g.inviteToken}` : ''
  }

  async leaveGroup(id: string) {
    const a = this.need()
    await groupApi.removeMember(await this.token(), id, a.me)
    await this.refreshGroups()
  }

  // ── safety numbers ──────────────────────────────────────────────────

  async safety(contactId: string): Promise<SafetyInfo> {
    const a = this.need()
    const token = await this.token()
    const [sn, trust, c] = await Promise.all([loadSafetyNumber(a.me, contactId, token), getTrust(a.me, contactId), this.getContact(contactId)])
    return {
      contactId,
      contactName: c?.displayName ?? contactId,
      digits: digitsOfQr(sn.qrValue),
      qrPayload: sn.qrValue,
      verified: !!trust?.verified && !trust.changed,
    }
  }

  async setVerified(contactId: string, verified: boolean) {
    const a = this.need()
    const token = await this.token()
    const keys = await resolveContactKeys(a.me, contactId, token)
    if (keys.trust.changed) await acknowledgeKeyChange(a.me, contactId)
    const trust = await getTrust(a.me, contactId)
    if (trust) await coreSetVerified(a.me, contactId, trust.fingerprint, verified)
    this.events.emit(`safety:${contactId}` as Topic)
    this.events.emit('contacts')
  }

  // ── backup ──────────────────────────────────────────────────────────

  async backupStatus(): Promise<BackupStatus> {
    const a = this.need()
    const enabled = await isBackupEnabled(a.me)
    const last = await lastBackupAt(a.me)
    const meta = await fetchBackupMeta(await this.token()).catch(() => null)
    return { enabled, lastBackupAt: last ?? undefined, sizeBytes: meta?.size, serverBackup: !!meta?.exists }
  }

  async enableBackup(): Promise<string> {
    const a = this.need()
    const key = await enableBackup(a.me, await this.token())
    this.events.emit('backup')
    return key
  }

  async disableBackup() {
    const a = this.need()
    await disableBackup(a.me, await this.token())
    this.events.emit('backup')
  }

  async backupNow(): Promise<BackupStatus> {
    const a = this.need()
    await coreBackupNow(a.me, await this.token())
    this.events.emit('backup')
    return this.backupStatus()
  }

  async restore(recoveryKey: string): Promise<number> {
    const a = this.need()
    const n = await restoreBackup(a.me, await this.token(), recoveryKey)
    a.lastCache.clear()
    this.events.emit('chats')
    for (const u of a.users) this.events.emit(`messages:${u.username}` as Topic)
    this.events.emit('backup')
    return n
  }

  // ── devices ─────────────────────────────────────────────────────────

  async devices(): Promise<DeviceInfo[]> {
    const a = this.need()
    const list = await signalApi.devicesOf(await this.token(), a.me)
    return list.map(d => ({
      id: String(d.deviceId),
      name: d.label || `Device ${d.deviceId}`,
      platform: /android|phone|redmi|pixel|samsung/i.test(d.label ?? '') ? 'android' : /ios|iphone|ipad/i.test(d.label ?? '') ? 'ios' : 'web',
      lastActive: Date.parse(d.lastSeen ?? d.createdAt ?? '') || 0,
      current: d.deviceId === a.ctx?.deviceId,
    }))
  }

  async revokeDevice(id: string) {
    await signalApi.removeDevice(await this.token(), Number(id))
    this.events.emit('devices')
  }
}

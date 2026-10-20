/**
 * Abstract data layer for the Iris mobile UI.
 *
 * Screens only ever talk to these interfaces (via the hooks in ./hooks.ts).
 * `mock/` implements them with in-memory data; the real implementation (backed by
 * @iris/core + platform adapters) replaces it without touching any screen.
 *
 * Change notification: every service publishes on a shared `ServiceEvents` bus using
 * the topics in `Topic`. Hooks refetch when a topic they depend on fires.
 */

// ── model ────────────────────────────────────────────────────────────────

export interface Session {
  userId: string
  username: string
  displayName: string
  /** True while the app lock / unlock screen must be shown. */
  locked: boolean
}

export interface Contact {
  id: string
  username: string
  displayName: string
  online: boolean
  /** epoch ms, absent while online or when the peer hides it. */
  lastSeen?: number
  verified: boolean
  blocked: boolean
}

export interface FriendRequest {
  id: string
  from: Contact
  createdAt: number
}

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface ReplyRef {
  id: string
  senderName: string
  text: string
}

export interface Message {
  id: string
  chatId: string
  senderId: string
  /** Display name of the sender (used in group chats). */
  senderName: string
  fromMe: boolean
  text: string
  /** epoch ms */
  at: number
  status: MessageStatus
  replyTo?: ReplyRef
  /** Present for photo / video / document messages (`text` then holds the caption). */
  media?: MessageMedia
}

export interface MessageMedia {
  mediaId: string
  /** base64 AES key from the decrypted envelope. */
  key: string
  mime: string
  caption: string
  name?: string
  size?: number
  w?: number
  h?: number
  dur?: number
  bh?: string
  viewOnce: boolean
  /** View-once consumed (by the recipient, or locally). */
  viewed: boolean
  /** Sender side, while uploading: the live job (see media/session.ts). */
  pending?: import('@/media').OutgoingMedia
}

export type ChatKind = 'direct' | 'group'

export interface ChatSummary {
  id: string
  kind: ChatKind
  title: string
  /** direct chats: the peer's contact id */
  peerId?: string
  online: boolean
  memberCount?: number
  lastMessage?: Pick<Message, 'text' | 'at' | 'fromMe' | 'status' | 'senderName'>
  unread: number
  pinned: boolean
  muted: boolean
  archived: boolean
  typing: boolean
}

export type GroupRole = 'owner' | 'admin' | 'member'

export interface GroupMember {
  userId: string
  displayName: string
  username: string
  role: GroupRole
  online: boolean
  isMe: boolean
}

export interface GroupDetail {
  id: string
  name: string
  createdAt: number
  members: GroupMember[]
  inviteLink: string
  myRole: GroupRole
}

export interface PrivacyState {
  privateProfile: boolean
  allowInvites: boolean
  inviteCode: string
  inviteUrl: string
}

export interface SafetyInfo {
  contactId: string
  contactName: string
  /** 60 digits, no separators. */
  digits: string
  /** Payload encoded into the QR code. */
  qrPayload: string
  verified: boolean
}

export interface BackupStatus {
  enabled: boolean
  lastBackupAt?: number
  sizeBytes?: number
  /** A backup exists on the server (this account), whether or not this device keeps it up to date. */
  serverBackup?: boolean
}

export interface DeviceInfo {
  id: string
  name: string
  platform: 'android' | 'ios' | 'web'
  lastActive: number
  current: boolean
}

export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppSettings {
  theme: ThemeMode
  screenSecurity: boolean
  appLock: boolean
  haptics: boolean
  notifications: boolean
  /** Show sender and text in message notifications. Off: "Iris / New message" (messages still decrypt). */
  messagePreview: boolean
}

// ── services ─────────────────────────────────────────────────────────────

export interface AuthService {
  /** Resolves the persisted session, or null when signed out. */
  getSession(): Promise<Session | null>
  login(username: string, password: string): Promise<Session>
  signup(username: string, password: string): Promise<Session>
  /** Resolves `true` when the username is free. */
  isUsernameAvailable(username: string): Promise<boolean>
  logout(): Promise<void>
  lock(): Promise<void>
  /** Throws AuthError('bad-password') on mismatch. */
  unlock(password: string): Promise<Session>
  /** System biometric / screen-lock prompt (app lock). Optional: the mock has none. */
  unlockWithBiometrics?(): Promise<Session>
}

export interface ContactsService {
  list(): Promise<Contact[]>
  get(id: string): Promise<Contact | null>
  requests(): Promise<FriendRequest[]>
  acceptRequest(id: string): Promise<void>
  declineRequest(id: string): Promise<void>
  /** Add by invite code (XXXXX-XXXXX) or username. Returns the new/pending contact. */
  add(codeOrUsername: string): Promise<Contact>
  block(id: string): Promise<void>
  unblock(id: string): Promise<void>
  blocked(): Promise<Contact[]>
}

export interface ChatsService {
  list(): Promise<ChatSummary[]>
  get(chatId: string): Promise<ChatSummary | null>
  /** Newest-first page; `before` is a message `at` cursor. */
  messages(chatId: string, opts?: { before?: number; limit?: number }): Promise<Message[]>
  send(chatId: string, text: string, replyToId?: string): Promise<Message>
  retry(chatId: string, messageId: string): Promise<void>
  setTyping(chatId: string, typing: boolean): void
  markRead(chatId: string): Promise<void>
  deleteForMe(chatId: string, messageId: string): Promise<void>
  openDirect(contactId: string): Promise<string>
  setPinned(chatId: string, value: boolean): Promise<void>
  setMuted(chatId: string, value: boolean): Promise<void>
  setArchived(chatId: string, value: boolean): Promise<void>
  /** Pull-to-refresh: sync with server. */
  refresh(): Promise<void>
}

export interface ProfileService {
  get(): Promise<{ username: string; displayName: string; bio: string }>
  update(patch: { displayName?: string; bio?: string }): Promise<void>
}

export interface PrivacyService {
  get(): Promise<PrivacyState>
  setPrivateProfile(value: boolean): Promise<void>
  setAllowInvites(value: boolean): Promise<void>
  rotateInvite(): Promise<PrivacyState>
}

export interface GroupsService {
  create(name: string, memberIds: string[]): Promise<string>
  get(groupId: string): Promise<GroupDetail | null>
  rename(groupId: string, name: string): Promise<void>
  resetInvite(groupId: string): Promise<string>
  leave(groupId: string): Promise<void>
}

export interface SafetyService {
  get(contactId: string): Promise<SafetyInfo>
  setVerified(contactId: string, verified: boolean): Promise<void>
}

export interface BackupService {
  status(): Promise<BackupStatus>
  /** Turn backups on. Resolves the recovery key (shown to the user exactly once). */
  enable(): Promise<string>
  disable(): Promise<void>
  backupNow(): Promise<BackupStatus>
  /** Restore this account's server backup with the recovery key. Resolves the number of messages restored. */
  restore(recoveryKey: string): Promise<number>
}

export interface DevicesService {
  list(): Promise<DeviceInfo[]>
  revoke(id: string): Promise<void>
}

export interface SettingsService {
  get(): Promise<AppSettings>
  update(patch: Partial<AppSettings>): Promise<AppSettings>
}

export type Topic =
  | 'session'
  | 'contacts'
  | 'requests'
  | 'chats'
  | `messages:${string}`
  | `typing:${string}`
  | 'profile'
  | 'privacy'
  | `group:${string}`
  | `safety:${string}`
  | 'backup'
  | 'devices'
  | 'settings'

export interface ServiceEvents {
  on(topic: Topic, fn: () => void): () => void
  emit(topic: Topic): void
}

export interface Services {
  events: ServiceEvents
  auth: AuthService
  contacts: ContactsService
  chats: ChatsService
  profile: ProfileService
  privacy: PrivacyService
  groups: GroupsService
  safety: SafetyService
  backup: BackupService
  devices: DevicesService
  settings: SettingsService
}

export type AuthErrorCode = 'bad-password' | 'bad-credentials' | 'username-taken' | 'invalid-username' | 'network'

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'AuthError'
  }
}

export class ServiceError extends Error {
  constructor(public code: 'not-found' | 'invalid-code' | 'already-friends' | 'blocked' | 'network', message?: string) {
    super(message ?? code)
    this.name = 'ServiceError'
  }
}

import { hashString, normalizeInviteCode, formatInviteCode, isValidUsername } from '@/ui/lib/validation'
import {
  AuthError,
  ServiceError,
  type AppSettings,
  type BackupStatus,
  type ChatSummary,
  type Contact,
  type DeviceInfo,
  type FriendRequest,
  type GroupDetail,
  type GroupMember,
  type Message,
  type PrivacyState,
  type SafetyInfo,
  type ServiceEvents,
  type Services,
  type Session,
  type Topic,
} from '../services'

export interface MockOptions {
  /** Artificial network latency in ms (0 disables; tests use 0). */
  latency?: number
  /** Simulate peers replying (typing + read receipts). */
  autoReply?: boolean
  /** Start already signed in. */
  signedIn?: boolean
  /** Clock override for deterministic seeds. */
  now?: () => number
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function createEvents(): ServiceEvents {
  const map = new Map<string, Set<() => void>>()
  return {
    on(topic, fn) {
      let set = map.get(topic)
      if (!set) map.set(topic, (set = new Set()))
      set.add(fn)
      return () => {
        set!.delete(fn)
      }
    },
    emit(topic) {
      map.get(topic)?.forEach(fn => fn())
    },
  }
}

/** Deterministic fake 60 digit safety number, symmetric in its two inputs. */
export function fakeSafetyDigits(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a]
  let digits = ''
  let seed = hashString(`${x}|${y}`)
  while (digits.length < 60) {
    seed = hashString(`${seed}:${x}:${y}:${digits.length}`)
    digits += (seed % 100000).toString().padStart(5, '0')
  }
  return digits.slice(0, 60)
}

const REPLIES = [
  'Haha yes, exactly',
  'Give me a few minutes',
  'Sounds good to me',
  'Wait, really?',
  'On my way',
  'Can you send that again?',
  'Love it',
  'Let me check and get back to you',
  'Okay, perfect',
  "That's wild",
]

interface ChatRecord {
  summary: ChatSummary
  /** newest-first */
  messages: Message[]
  groupMembers?: GroupMember[]
  groupInvite?: string
  createdAt: number
}

export function createMockServices(opts: MockOptions = {}): Services {
  const latency = opts.latency ?? 280
  const autoReply = opts.autoReply ?? true
  const now = opts.now ?? (() => Date.now())
  const events = createEvents()
  let idSeq = 1
  const nid = (p: string) => `${p}${(idSeq++).toString(36)}`
  const wait = <T>(v: T, ms = latency): Promise<T> =>
    ms <= 0 ? Promise.resolve(v) : new Promise(r => setTimeout(() => r(v), ms * (0.6 + Math.random() * 0.8)))
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number) => {
    if (!autoReply) return
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }

  // ── seed ───────────────────────────────────────────────────────────────
  const t0 = now()
  let session: Session | null = opts.signedIn ? { userId: 'me', username: 'you', displayName: 'You', locked: false } : null
  let password = 'password'
  const takenUsernames = new Set(['admin', 'iris', 'mira', 'dev', 'root'])

  const mk = (id: string, displayName: string, username: string, extra: Partial<Contact> = {}): Contact => ({
    id,
    displayName,
    username,
    online: false,
    verified: false,
    blocked: false,
    ...extra,
  })
  const contacts = new Map<string, Contact>(
    [
      mk('c1', 'Mira Kapoor', 'mira_k', { online: true, verified: true }),
      mk('c2', 'Dev Patel', 'devpatel', { lastSeen: t0 - 12 * MIN }),
      mk('c3', 'Ana Silva', 'ana_s', { online: true }),
      mk('c4', 'Leo Chen', 'leochen', { lastSeen: t0 - 3 * HOUR }),
      mk('c5', 'Sam Okafor', 'sam_o', { lastSeen: t0 - 1 * DAY }),
      mk('c6', 'Noor Haddad', 'noorh', { online: true }),
      mk('c7', 'Jonas Weber', 'jonasw', { lastSeen: t0 - 2 * DAY }),
      mk('c8', 'Priya Nair', 'priyan', { lastSeen: t0 - 40 * MIN }),
      mk('c9', 'Troll Account', 'troll99', { blocked: true }),
    ].map(c => [c.id, c]),
  )
  let requests: FriendRequest[] = [
    { id: 'r1', from: mk('u-r1', 'Kai Nakamura', 'kai_n', { online: true }), createdAt: t0 - 2 * HOUR },
    { id: 'r2', from: mk('u-r2', 'Elena Rossi', 'elenar'), createdAt: t0 - 1 * DAY },
  ]

  const chats = new Map<string, ChatRecord>()
  const addMsgs = (chatId: string, rows: Array<[string, string, number, Partial<Message>?]>, groupNames?: Map<string, string>) => {
    // rows oldest-first: [senderId, text, minutesAgo]
    const list: Message[] = rows.map(([senderId, text, agoMin, extra]) => {
      const fromMe = senderId === 'me'
      return {
        id: nid('m'),
        chatId,
        senderId,
        senderName: fromMe ? 'You' : (groupNames?.get(senderId) ?? contacts.get(senderId)?.displayName ?? 'Unknown'),
        fromMe,
        text,
        at: t0 - agoMin * MIN,
        status: fromMe ? 'read' : 'delivered',
        ...extra,
      } as Message
    })
    return list.reverse()
  }
  const summarize = (r: ChatRecord) => {
    const m = r.messages[0]
    r.summary.lastMessage = m ? { text: m.text, at: m.at, fromMe: m.fromMe, status: m.status, senderName: m.senderName } : undefined
  }
  const addDirect = (contactId: string, rows: Array<[string, string, number, Partial<Message>?]>, unread = 0, extra: Partial<ChatSummary> = {}) => {
    const c = contacts.get(contactId)!
    const id = `chat-${contactId}`
    const rec: ChatRecord = {
      createdAt: t0 - 5 * DAY,
      messages: addMsgs(id, rows),
      summary: {
        id,
        kind: 'direct',
        title: c.displayName,
        peerId: contactId,
        online: c.online,
        unread,
        pinned: false,
        muted: false,
        archived: false,
        typing: false,
        ...extra,
      },
    }
    summarize(rec)
    chats.set(id, rec)
  }

  addDirect(
    'c1',
    [
      ['c1', 'Hey! Did you get the new build running?', 3 * 24 * 60 + 40],
      ['me', 'Yes, it is buttery smooth on my phone', 3 * 24 * 60 + 38],
      ['c1', 'Nice. Safety numbers matched, by the way.', 26 * 60 + 12],
      ['me', 'Great, marked as verified', 26 * 60 + 10],
      ['c1', 'Are we still on for tonight?', 95],
      ['me', 'Yep! 7pm at the usual place?', 92],
      ['c1', 'Perfect', 90],
      ['c1', 'I will bring the notes', 89],
      ['c1', 'Also, check this: swipe right on a message to reply', 4],
    ],
    2,
    { pinned: true },
  )
  addDirect('c2', [['c2', 'snap', 60 * 30], ['me', 'Got it', 60 * 29], ['c2', 'Sent you the invite', 60 * 24 + 5]], 0)
  addDirect('c3', [['me', 'See you at 6', 60 * 24 * 2], ['c3', 'See you at 6, bringing snacks', 60 * 24 * 2 - 3]], 1)
  addDirect('c4', [['me', 'Thanks for the help earlier!', 60 * 5], ['c4', 'Anytime.', 60 * 4 + 50]], 0, { muted: true })
  addDirect('c6', [['c6', 'Voice note coming later, my mic is acting up', 60 * 24 * 6]], 0)

  const names = (ids: string[]) => new Map(ids.map(i => [i, contacts.get(i)?.displayName ?? i]))
  const addGroup = (
    id: string,
    name: string,
    memberIds: string[],
    rows: Array<[string, string, number, Partial<Message>?]>,
    unread: number,
    adminIds: string[] = [],
  ) => {
    const members: GroupMember[] = [
      { userId: 'me', displayName: 'You', username: session?.username ?? 'you', role: 'owner', online: true, isMe: true },
      ...memberIds.map(
        (mid): GroupMember => ({
          userId: mid,
          displayName: contacts.get(mid)!.displayName,
          username: contacts.get(mid)!.username,
          role: adminIds.includes(mid) ? 'admin' : 'member',
          online: contacts.get(mid)!.online,
          isMe: false,
        }),
      ),
    ]
    const rec: ChatRecord = {
      createdAt: t0 - 12 * DAY,
      messages: addMsgs(id, rows, names(memberIds)),
      groupMembers: members,
      groupInvite: `https://iris.chat/?join=${formatInviteCode(hashString(id).toString(32).toUpperCase().padEnd(10, 'X').slice(0, 10))}`,
      summary: { id, kind: 'group', title: name, online: false, memberCount: members.length, unread, pinned: false, muted: false, archived: false, typing: false },
    }
    summarize(rec)
    chats.set(id, rec)
  }
  addGroup(
    'g1',
    'Weekend Hike',
    ['c1', 'c3', 'c6', 'c8'],
    [
      ['c3', 'Trail is open this Saturday!', 60 * 26],
      ['c6', 'I can drive, 3 seats free', 60 * 25],
      ['me', 'Count me in', 60 * 24],
      ['c8', 'Bringing the good coffee', 60 * 3],
      ['c1', 'Weather looks great', 25],
    ],
    2,
    ['c1'],
  )
  addGroup(
    'g2',
    'Iris Beta Testers',
    ['c2', 'c4', 'c5', 'c7'],
    [
      ['c2', 'Build 0.1.0 is live for everyone', 60 * 24 * 4],
      ['c5', 'Group invites work now', 60 * 24 * 3],
      ['me', 'Thanks for testing, report anything weird', 60 * 24 * 3 - 5],
    ],
    0,
  )

  let profile = { username: 'you', displayName: 'You', bio: 'Private by design.' }
  let privacy: PrivacyState = { privateProfile: false, allowInvites: true, inviteCode: 'K7Q2M-9XD4V', inviteUrl: '' }
  const syncInviteUrl = () => {
    privacy.inviteUrl = `https://iris.chat/?add=${privacy.inviteCode}`
  }
  syncInviteUrl()
  let backup: BackupStatus = { enabled: false }
  let devices: DeviceInfo[] = [
    { id: 'd1', name: 'This phone', platform: 'android', lastActive: t0, current: true },
    { id: 'd2', name: 'Chrome on Windows', platform: 'web', lastActive: t0 - 2 * HOUR, current: false },
    { id: 'd3', name: 'iPad', platform: 'ios', lastActive: t0 - 6 * DAY, current: false },
  ]
  let settings: AppSettings = { theme: 'system', screenSecurity: false, appLock: false, haptics: true, notifications: true }

  const rec = (id: string) => {
    const r = chats.get(id)
    if (!r) throw new ServiceError('not-found', `chat ${id}`)
    return r
  }
  const emitChat = (id: string) => {
    events.emit(`messages:${id}`)
    events.emit('chats')
  }
  const syncPeerState = () => {
    for (const r of chats.values()) {
      if (r.summary.kind === 'direct' && r.summary.peerId) {
        const c = contacts.get(r.summary.peerId)
        if (c) {
          r.summary.online = c.online
          r.summary.title = c.displayName
        }
      }
    }
  }

  // ── services ───────────────────────────────────────────────────────────
  return {
    events,

    auth: {
      getSession: () => wait(session, latency / 2),
      async login(username, pw) {
        await wait(0)
        if (!username || !pw) throw new AuthError('bad-credentials')
        if (pw.length < 1) throw new AuthError('bad-credentials')
        password = pw
        session = { userId: 'me', username, displayName: username, locked: false }
        profile = { ...profile, username, displayName: username }
        events.emit('session')
        return wait(session)
      },
      async signup(username, pw) {
        if (!isValidUsername(username)) throw new AuthError('invalid-username')
        if (takenUsernames.has(username.toLowerCase())) throw new AuthError('username-taken')
        await wait(0)
        password = pw
        session = { userId: 'me', username, displayName: username, locked: false }
        profile = { ...profile, username, displayName: username }
        events.emit('session')
        return wait(session, latency * 2)
      },
      isUsernameAvailable: u => wait(!takenUsernames.has(u.toLowerCase()), latency / 2),
      async logout() {
        session = null
        events.emit('session')
      },
      async lock() {
        if (session) session = { ...session, locked: true }
        events.emit('session')
      },
      async unlock(pw) {
        await wait(0, latency)
        if (!session) throw new AuthError('bad-credentials')
        if (pw !== password) throw new AuthError('bad-password')
        session = { ...session, locked: false }
        events.emit('session')
        return session
      },
    },

    contacts: {
      list: () => wait([...contacts.values()].filter(c => !c.blocked).sort((a, b) => a.displayName.localeCompare(b.displayName))),
      get: id => wait(contacts.get(id) ?? null, latency / 3),
      requests: () => wait([...requests]),
      async acceptRequest(id) {
        const r = requests.find(x => x.id === id)
        if (r) {
          contacts.set(r.from.id, r.from)
          requests = requests.filter(x => x.id !== id)
          events.emit('requests')
          events.emit('contacts')
        }
        await wait(undefined)
      },
      async declineRequest(id) {
        requests = requests.filter(x => x.id !== id)
        events.emit('requests')
        await wait(undefined, latency / 2)
      },
      async add(codeOrUsername) {
        await wait(0)
        const input = codeOrUsername.trim()
        const code = normalizeInviteCode(input)
        const uname = input.replace(/^@/, '')
        const existing = [...contacts.values()].find(c => c.username.toLowerCase() === uname.toLowerCase())
        if (existing) throw new ServiceError('already-friends')
        if (!code && !isValidUsername(uname)) throw new ServiceError('invalid-code')
        if (code && code.startsWith('0')) throw new ServiceError('not-found') // demo: codes starting with 0 do not exist
        const c = mk(nid('u'), code ? `Friend ${formatInviteCode(code).slice(0, 5)}` : uname, code ? `user_${code.slice(0, 5).toLowerCase()}` : uname)
        contacts.set(c.id, c)
        events.emit('contacts')
        return wait(c)
      },
      async block(id) {
        const c = contacts.get(id)
        if (c) contacts.set(id, { ...c, blocked: true })
        events.emit('contacts')
        await wait(undefined, latency / 2)
      },
      async unblock(id) {
        const c = contacts.get(id)
        if (c) contacts.set(id, { ...c, blocked: false })
        events.emit('contacts')
        await wait(undefined, latency / 2)
      },
      blocked: () => wait([...contacts.values()].filter(c => c.blocked)),
    },

    chats: {
      list() {
        syncPeerState()
        const rows = [...chats.values()]
          .map(r => ({ ...r.summary }))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0))
        return wait(rows)
      },
      async get(chatId) {
        syncPeerState()
        const r = chats.get(chatId)
        return wait(r ? { ...r.summary } : null, latency / 3)
      },
      async messages(chatId, o = {}) {
        const r = rec(chatId)
        const limit = o.limit ?? 40
        const rows = r.messages.filter(m => (o.before ? m.at < o.before : true)).slice(0, limit)
        return wait(rows.map(m => ({ ...m })), latency / 2)
      },
      async send(chatId, text, replyToId) {
        const r = rec(chatId)
        const reply = replyToId ? r.messages.find(m => m.id === replyToId) : undefined
        const msg: Message = {
          id: nid('m'),
          chatId,
          senderId: 'me',
          senderName: 'You',
          fromMe: true,
          text,
          at: now(),
          status: 'sending',
          replyTo: reply ? { id: reply.id, senderName: reply.senderName, text: reply.text } : undefined,
        }
        r.messages.unshift(msg)
        summarize(r)
        emitChat(chatId)
        const setStatus = (status: Message['status']) => {
          msg.status = status
          summarize(r)
          emitChat(chatId)
        }
        later(() => setStatus('sent'), 350)
        if (!autoReply) setTimeout(() => setStatus('sent'), 0)
        later(() => setStatus('delivered'), 1000)
        later(() => setStatus('read'), 2200)
        later(() => {
          r.summary.typing = true
          events.emit(`typing:${chatId}`)
          events.emit('chats')
        }, 2600)
        later(() => {
          r.summary.typing = false
          events.emit(`typing:${chatId}`)
          const group = r.summary.kind === 'group'
          const peers = group ? r.groupMembers!.filter(m => !m.isMe) : []
          const peer = group ? peers[hashString(msg.id) % peers.length]! : null
          const reply: Message = {
            id: nid('m'),
            chatId,
            senderId: peer?.userId ?? r.summary.peerId ?? 'peer',
            senderName: peer?.displayName ?? r.summary.title,
            fromMe: false,
            text: REPLIES[hashString(text) % REPLIES.length]!,
            at: now(),
            status: 'delivered',
          }
          r.messages.unshift(reply)
          r.summary.unread += 1
          summarize(r)
          emitChat(chatId)
        }, 4600)
        return wait({ ...msg }, 0)
      },
      async retry(chatId, messageId) {
        const m = rec(chatId).messages.find(x => x.id === messageId)
        if (m) {
          m.status = 'sent'
          emitChat(chatId)
        }
      },
      setTyping() {
        /* mock: nothing to transmit */
      },
      async markRead(chatId) {
        const r = rec(chatId)
        if (r.summary.unread) {
          r.summary.unread = 0
          events.emit('chats')
        }
      },
      async deleteForMe(chatId, messageId) {
        const r = rec(chatId)
        r.messages = r.messages.filter(m => m.id !== messageId)
        summarize(r)
        emitChat(chatId)
      },
      async openDirect(contactId) {
        const id = `chat-${contactId}`
        if (!chats.has(id)) {
          const c = contacts.get(contactId)
          if (!c) throw new ServiceError('not-found')
          chats.set(id, {
            createdAt: now(),
            messages: [],
            summary: { id, kind: 'direct', title: c.displayName, peerId: contactId, online: c.online, unread: 0, pinned: false, muted: false, archived: false, typing: false },
          })
          events.emit('chats')
        }
        return wait(id, latency / 3)
      },
      async setPinned(chatId, v) {
        rec(chatId).summary.pinned = v
        events.emit('chats')
      },
      async setMuted(chatId, v) {
        rec(chatId).summary.muted = v
        events.emit('chats')
      },
      async setArchived(chatId, v) {
        rec(chatId).summary.archived = v
        events.emit('chats')
      },
      async refresh() {
        await wait(undefined, latency * 3)
        events.emit('chats')
      },
    },

    profile: {
      get: () => wait({ ...profile }, latency / 2),
      async update(patch) {
        profile = { ...profile, ...patch }
        if (session && patch.displayName) session = { ...session, displayName: patch.displayName }
        events.emit('profile')
        events.emit('session')
        await wait(undefined)
      },
    },

    privacy: {
      get: () => wait({ ...privacy }, latency / 2),
      async setPrivateProfile(v) {
        privacy.privateProfile = v
        events.emit('privacy')
        await wait(undefined, latency / 2)
      },
      async setAllowInvites(v) {
        privacy.allowInvites = v
        events.emit('privacy')
        await wait(undefined, latency / 2)
      },
      async rotateInvite() {
        const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
        let code = ''
        for (let i = 0; i < 10; i++) code += A[Math.floor(Math.random() * A.length)]
        privacy.inviteCode = formatInviteCode(code)
        syncInviteUrl()
        events.emit('privacy')
        return wait({ ...privacy })
      },
    },

    groups: {
      async create(name, memberIds) {
        const id = nid('g')
        const members: GroupMember[] = [
          { userId: 'me', displayName: 'You', username: session?.username ?? 'you', role: 'owner', online: true, isMe: true },
          ...memberIds.flatMap((m): GroupMember[] => {
            const c = contacts.get(m)
            return c ? [{ userId: c.id, displayName: c.displayName, username: c.username, role: 'member', online: c.online, isMe: false }] : []
          }),
        ]
        chats.set(id, {
          createdAt: now(),
          messages: [],
          groupMembers: members,
          groupInvite: `https://iris.chat/?join=${formatInviteCode(hashString(id).toString(32).toUpperCase().padEnd(10, 'X').slice(0, 10))}`,
          summary: { id, kind: 'group', title: name, online: false, memberCount: members.length, unread: 0, pinned: false, muted: false, archived: false, typing: false },
        })
        events.emit('chats')
        return wait(id)
      },
      async get(groupId) {
        const r = chats.get(groupId)
        if (!r || r.summary.kind !== 'group') return wait(null, latency / 3)
        const detail: GroupDetail = {
          id: groupId,
          name: r.summary.title,
          createdAt: r.createdAt,
          members: r.groupMembers!.map(m => ({ ...m })),
          inviteLink: r.groupInvite!,
          myRole: 'owner',
        }
        return wait(detail, latency / 2)
      },
      async rename(groupId, name) {
        rec(groupId).summary.title = name
        events.emit('chats')
        events.emit(`group:${groupId}`)
        await wait(undefined, latency / 2)
      },
      async resetInvite(groupId) {
        const r = rec(groupId)
        r.groupInvite = `https://iris.chat/?join=${formatInviteCode(hashString(nid('x')).toString(32).toUpperCase().padEnd(10, 'X').slice(0, 10))}`
        events.emit(`group:${groupId}`)
        return wait(r.groupInvite)
      },
      async leave(groupId) {
        chats.delete(groupId)
        events.emit('chats')
        await wait(undefined)
      },
    },

    safety: {
      async get(contactId): Promise<SafetyInfo> {
        const c = contacts.get(contactId)
        if (!c) throw new ServiceError('not-found')
        const digits = fakeSafetyDigits('me', contactId)
        return wait({ contactId, contactName: c.displayName, digits, qrPayload: `iris-safety:v1:${digits}`, verified: c.verified })
      },
      async setVerified(contactId, verified) {
        const c = contacts.get(contactId)
        if (c) contacts.set(contactId, { ...c, verified })
        events.emit(`safety:${contactId}`)
        events.emit('contacts')
        await wait(undefined, latency / 2)
      },
    },

    backup: {
      status: () => wait({ ...backup }, latency / 2),
      async setEnabled(v) {
        backup = { ...backup, enabled: v }
        events.emit('backup')
        await wait(undefined, latency / 2)
      },
      async backupNow() {
        await wait(undefined, latency * 4)
        backup = { enabled: true, lastBackupAt: now(), sizeBytes: 3_412_000 }
        events.emit('backup')
        return { ...backup }
      },
    },

    devices: {
      list: () => wait(devices.map(d => ({ ...d }))),
      async revoke(id) {
        devices = devices.filter(d => d.id !== id || d.current)
        events.emit('devices')
        await wait(undefined, latency / 2)
      },
    },

    settings: {
      get: () => wait({ ...settings }, latency / 3),
      async update(patch) {
        settings = { ...settings, ...patch }
        events.emit('settings')
        return { ...settings }
      },
    },
  }
}

export type { Topic }

import type { ChatMessage } from '@iris/core'
import { avatarColors } from '@/ui/lib/validation'

/**
 * Pure building blocks of message notifications (unit-tested). The native renderer
 * (modules/iris-calls/android/.../notify/MessageNotifier.kt) draws exactly what these produce.
 */

/** One line of a MessagingStyle notification. `me` lines render as "You". */
export type NotifyLine = {
  sender: string
  /** Stable person key (username). */
  key: string
  text: string
  at: number
  me: boolean
  /** Avatar gradient, same as the in-app avatar for this username. */
  c1?: string
  c2?: string
}

/** What MessageNotifier.showConversation takes (as JSON). */
export type ConversationNotification = {
  chatId: string
  /** Contact name, or the group name. */
  title: string
  group: boolean
  /** false = "Show message preview" off (or locked): title "Iris", body "New message", no lines. */
  preview: boolean
  unread: number
  /** Re-post without sound/vibration (after an inline reply). */
  silent?: boolean
  lines: NotifyLine[]
}

/** Most lines one conversation notification shows (the system trims further on small screens). */
export const MAX_LINES = 6
const MAX_TEXT = 400

type Previewable = Pick<ChatMessage, 'content' | 'mediaId' | 'mimeType' | 'mediaKey' | 'viewOnce'>

/** "📷 Photo", "🎥 Video · caption", "📷 View-once photo" (never a preview), or the text itself. */
export function notificationText(m: Previewable): string {
  if (!m.mediaId) return clip(m.content)
  const mime = (m.mimeType ?? '').toLowerCase()
  const video = mime.startsWith('video/')
  if (m.viewOnce) return video ? '🎥 View-once video' : '📷 View-once photo'
  const label = mime.startsWith('image/') ? '📷 Photo' : video ? '🎥 Video' : mime.startsWith('audio/') ? '🎤 Voice message' : '📄 Document'
  const caption = (m.content ?? '').trim()
  return caption ? `${label} · ${clip(caption)}` : label
}

function clip(s: string): string {
  const t = (s ?? '').trim()
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t
}

/**
 * The lines to show for one conversation: from the `unread`-th last incoming message on (at least the
 * newest one), including my own messages after it (an inline reply shows as "You: …"), newest MAX_LINES.
 */
export function conversationLines(
  history: ChatMessage[],
  opts: { me: string; unread: number; nameOf: (username: string) => string },
): NotifyLine[] {
  const msgs = history.filter(m => !m.system)
  let start = -1
  let seen = 0
  const want = Math.max(1, opts.unread)
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.from === opts.me) continue
    start = i
    if (++seen >= want) break
  }
  if (start < 0) return []
  return msgs.slice(start).slice(-MAX_LINES).map(m => {
    const me = m.from === opts.me
    const [c1, c2] = avatarColors(m.from)
    return {
      sender: me ? 'You' : opts.nameOf(m.from),
      key: m.from,
      text: notificationText(m),
      at: Date.parse(m.sentAt) || Date.now(),
      me,
      ...(me ? {} : { c1, c2 }),
    }
  })
}

/** Whether an incoming message should produce a notification at all. */
export function shouldNotify(o: {
  fromMe: boolean
  notificationsOn: boolean
  muted: boolean
  blocked: boolean
  /** That chat is open and the app is in the foreground. */
  looking: boolean
}): boolean {
  return !o.fromMe && o.notificationsOn && !o.muted && !o.blocked && !o.looking
}

/** Data of a push / notification action as the headless task receives it (strings only, from Android extras). */
export type TaskData =
  | { kind: 'push'; pushId?: string; type: 'msg'; mid?: string; eid?: string; et?: string; env?: string }
  | { kind: 'push'; pushId?: string; type: 'msg-wake' | 'friend-request' | 'friend-accepted' }
  | { kind: 'reply'; chatId: string; text: string }
  | { kind: 'read'; chatId: string }

/** Validates the untyped task payload; null for anything malformed. */
export function parseTaskData(raw: unknown): TaskData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined)
  const pushId = str('pushId')
  switch (str('kind')) {
    case 'push': {
      const type = str('type')
      if (type === 'msg') {
        const eid = str('eid'), et = str('et'), env = str('env')
        if (!eid || !/^\d+$/.test(eid) || (et !== '1' && et !== '3') || !env) return { kind: 'push', pushId, type: 'msg-wake' }
        return { kind: 'push', pushId, type, mid: str('mid'), eid, et, env }
      }
      if (type === 'msg-wake' || type === 'friend-request' || type === 'friend-accepted') return { kind: 'push', pushId, type }
      return null
    }
    case 'reply': {
      const chatId = str('chatId'), text = str('text')?.trim()
      return chatId && text ? { kind: 'reply', chatId, text } : null
    }
    case 'read': {
      const chatId = str('chatId')
      return chatId ? { kind: 'read', chatId } : null
    }
    default:
      return null
  }
}

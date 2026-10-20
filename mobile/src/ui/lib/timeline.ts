import type { Message } from '@/state/services'

/** Pure helpers that turn a message list into render rows, and format times. Unit-tested. */

const GROUP_GAP_MS = 5 * 60 * 1000

export type TimelineItem =
  | { type: 'typing'; key: 'typing' }
  | { type: 'date'; key: string; label: string }
  | {
      type: 'message'
      key: string
      message: Message
      /** first bubble of a run (top, in visual order) */
      first: boolean
      /** last bubble of a run (bottom, shows the tail + time) */
      last: boolean
    }

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dateLabel(ts: number, now = Date.now()): string {
  const day = startOfDay(ts)
  const today = startOfDay(now)
  const diff = Math.round((today - day) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const d = new Date(ts)
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' })
}

export function clockTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${h.toString().padStart(2, '0')}:${m}`
}

/** Chat-list timestamp: time today, "Yesterday", weekday this week, else short date. */
export function listTime(ts: number, now = Date.now()): string {
  const day = startOfDay(ts)
  const today = startOfDay(now)
  const diff = Math.round((today - day) / 86_400_000)
  if (diff <= 0) return clockTime(ts)
  if (diff === 1) return 'Yesterday'
  const d = new Date(ts)
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function lastSeenLabel(lastSeen: number | undefined, now = Date.now()): string {
  if (!lastSeen) return 'offline'
  const mins = Math.round((now - lastSeen) / 60_000)
  if (mins < 1) return 'last seen just now'
  if (mins < 60) return `last seen ${mins} min ago`
  const day = startOfDay(lastSeen)
  const diff = Math.round((startOfDay(now) - day) / 86_400_000)
  if (diff === 0) return `last seen today at ${clockTime(lastSeen)}`
  if (diff === 1) return `last seen yesterday at ${clockTime(lastSeen)}`
  return `last seen ${new Date(lastSeen).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

/**
 * Input: messages NEWEST-FIRST (as the service returns). Output: rows in the same order,
 * ready for an inverted list (index 0 renders at the bottom). Date separators are emitted
 * AFTER the last message of a day (i.e. visually above its first message).
 */
export function buildTimeline(messages: Message[], opts: { typing?: boolean; now?: number } = {}): TimelineItem[] {
  const out: TimelineItem[] = []
  if (opts.typing) out.push({ type: 'typing', key: 'typing' })
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    const newer = messages[i - 1] // visually below
    const older = messages[i + 1] // visually above
    const joinsOlder = !!older && older.senderId === m.senderId && m.at - older.at < GROUP_GAP_MS && startOfDay(older.at) === startOfDay(m.at)
    const joinsNewer = !!newer && newer.senderId === m.senderId && newer.at - m.at < GROUP_GAP_MS && startOfDay(newer.at) === startOfDay(m.at)
    out.push({ type: 'message', key: m.id, message: m, first: !joinsOlder, last: !joinsNewer })
    if (!older || startOfDay(older.at) !== startOfDay(m.at)) {
      out.push({ type: 'date', key: `date-${startOfDay(m.at)}`, label: dateLabel(m.at, opts.now) })
    }
  }
  return out
}

export function previewText(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

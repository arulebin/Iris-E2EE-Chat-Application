import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@iris/core'
import { avatarColors } from '@/ui/lib/validation'
import { MAX_LINES, conversationLines, notificationText, parseTaskData, shouldNotify } from './format'

const msg = (id: number, from: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, from, to: 'me', content, sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(), v: 2, ...extra,
})

describe('notificationText', () => {
  it('shows text as is', () => {
    expect(notificationText(msg(1, 'a', 'hello'))).toBe('hello')
  })

  it('labels media by type, with the caption when there is one', () => {
    const media = (mimeType: string, content = '') => msg(1, 'a', content, { mediaId: 'm1', mediaKey: 'k', mimeType })
    expect(notificationText(media('image/jpeg'))).toBe('📷 Photo')
    expect(notificationText(media('image/jpeg', 'beach'))).toBe('📷 Photo · beach')
    expect(notificationText(media('video/mp4'))).toBe('🎥 Video')
    expect(notificationText(media('audio/mp4'))).toBe('🎤 Voice message')
    expect(notificationText(media('application/pdf', 'invoice'))).toBe('📄 Document · invoice')
  })

  it('never previews a view-once message, not even its caption', () => {
    const vo = (mimeType: string) => msg(1, 'a', 'secret caption', { mediaId: 'm1', mediaKey: 'k', mimeType, viewOnce: true })
    expect(notificationText(vo('image/png'))).toBe('📷 View-once photo')
    expect(notificationText(vo('video/mp4'))).toBe('🎥 View-once video')
  })

  it('clips very long text', () => {
    expect(notificationText(msg(1, 'a', 'x'.repeat(1000))).length).toBeLessThanOrEqual(400)
  })
})

describe('conversationLines', () => {
  const nameOf = (u: string) => (u === 'alice' ? 'Alice A' : u)

  it('shows the unread incoming messages, oldest first, with names and avatar colors', () => {
    const h = [msg(1, 'alice', 'old'), msg(2, 'me', 'mine'), msg(3, 'alice', 'one'), msg(4, 'alice', 'two')]
    const lines = conversationLines(h, { me: 'me', unread: 2, nameOf })
    expect(lines.map(l => l.text)).toEqual(['one', 'two'])
    expect(lines[0]).toMatchObject({ sender: 'Alice A', key: 'alice', me: false })
    expect([lines[0]!.c1, lines[0]!.c2]).toEqual(avatarColors('alice'))
  })

  it('keeps my reply after the incoming lines (inline reply shows "You: …")', () => {
    const h = [msg(1, 'alice', 'hi'), msg(2, 'me', 'hey back')]
    const lines = conversationLines(h, { me: 'me', unread: 1, nameOf })
    expect(lines.map(l => [l.sender, l.text, l.me])).toEqual([['Alice A', 'hi', false], ['You', 'hey back', true]])
    expect(lines[1]!.c1).toBeUndefined()
  })

  it('always shows at least the newest incoming message and caps the length', () => {
    const h = Array.from({ length: 20 }, (_, i) => msg(i + 1, 'bob', `m${i + 1}`))
    expect(conversationLines(h, { me: 'me', unread: 0, nameOf }).map(l => l.text)).toEqual(['m20'])
    const many = conversationLines(h, { me: 'me', unread: 50, nameOf })
    expect(many).toHaveLength(MAX_LINES)
    expect(many.at(-1)!.text).toBe('m20')
  })

  it('names each sender in a group and skips system lines', () => {
    const h = [msg(1, 'alice', 'a'), { ...msg(2, '', 'Alice added Bob'), system: true }, msg(3, 'bob', 'b')]
    expect(conversationLines(h, { me: 'me', unread: 2, nameOf }).map(l => `${l.sender}: ${l.text}`)).toEqual(['Alice A: a', 'bob: b'])
  })

  it('is empty when nothing came in', () => {
    expect(conversationLines([msg(1, 'me', 'x')], { me: 'me', unread: 1, nameOf })).toEqual([])
  })
})

describe('shouldNotify', () => {
  const base = { fromMe: false, notificationsOn: true, muted: false, blocked: false, looking: false }
  it('notifies for a normal incoming message', () => expect(shouldNotify(base)).toBe(true))
  it.each([
    ['my own (other device)', { fromMe: true }],
    ['notifications off', { notificationsOn: false }],
    ['muted chat', { muted: true }],
    ['blocked sender', { blocked: true }],
    ['chat open in the foreground', { looking: true }],
  ])('stays silent: %s', (_n, patch) => expect(shouldNotify({ ...base, ...patch })).toBe(false))
})

describe('parseTaskData', () => {
  it('accepts a message push and keeps only known fields', () => {
    expect(parseTaskData({ kind: 'push', pushId: 'p', type: 'msg', mid: '5', eid: '9', et: '3', env: 'AAA', extra: 'x' }))
      .toEqual({ kind: 'push', pushId: 'p', type: 'msg', mid: '5', eid: '9', et: '3', env: 'AAA' })
  })

  it('degrades a malformed message push to a wake-up (fetch what is pending)', () => {
    expect(parseTaskData({ kind: 'push', type: 'msg', eid: 'x', et: '1', env: 'A' })).toMatchObject({ type: 'msg-wake' })
    expect(parseTaskData({ kind: 'push', type: 'msg', eid: '1', et: '2', env: 'A' })).toMatchObject({ type: 'msg-wake' })
    expect(parseTaskData({ kind: 'push', type: 'msg', eid: '1', et: '1' })).toMatchObject({ type: 'msg-wake' })
  })

  it('accepts wake / social pushes and notification actions', () => {
    expect(parseTaskData({ kind: 'push', type: 'friend-request' })).toEqual({ kind: 'push', pushId: undefined, type: 'friend-request' })
    expect(parseTaskData({ kind: 'reply', chatId: 'alice', text: '  ok  ' })).toEqual({ kind: 'reply', chatId: 'alice', text: 'ok' })
    expect(parseTaskData({ kind: 'read', chatId: 'g1' })).toEqual({ kind: 'read', chatId: 'g1' })
  })

  it('rejects junk', () => {
    expect(parseTaskData(null)).toBeNull()
    expect(parseTaskData({ kind: 'push', type: 'incoming-call' })).toBeNull()
    expect(parseTaskData({ kind: 'reply', chatId: 'a', text: '   ' })).toBeNull()
    expect(parseTaskData({ kind: 'nope' })).toBeNull()
  })
})

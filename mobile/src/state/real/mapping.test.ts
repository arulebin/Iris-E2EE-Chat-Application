import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@iris/core'
import { displayName, mediaOf, messageKey, previewText, statusOf, toUiMessage } from './mapping'

const base = (o: Partial<ChatMessage>): ChatMessage => ({ from: 'bob', to: 'me', content: 'hi', sentAt: '2026-01-01T10:00:00Z', ...o })

describe('mapping', () => {
  it('uses the server id once known, the client id before', () => {
    expect(messageKey(base({ id: 5 }))).toBe('5')
    expect(messageKey(base({ clientId: 'abc' }))).toBe('c:abc')
  })

  it('derives my message status from confirmation and the peer read time', () => {
    const mine = base({ from: 'me', to: 'bob', id: 1 })
    expect(statusOf(base({ from: 'me', to: 'bob' }), 'me', 0)).toBe('sending')
    expect(statusOf(mine, 'me', 0)).toBe('sent')
    expect(statusOf(mine, 'me', Date.parse('2026-01-01T10:00:01Z'))).toBe('read')
    expect(statusOf({ ...mine, readAt: '2026-01-01T11:00:00Z' }, 'me', 0)).toBe('read')
    expect(statusOf(base({ id: 2 }), 'me', 0)).toBe('read') // incoming
  })

  it('maps media messages and previews', () => {
    const m = base({ id: 3, mediaId: 'm1', mediaKey: 'k', mimeType: 'image/jpeg', content: 'look', mediaMeta: { w: 10, h: 20 }, viewOnce: true })
    expect(mediaOf(m)).toMatchObject({ mediaId: 'm1', key: 'k', mime: 'image/jpeg', caption: 'look', w: 10, h: 20, viewOnce: true, viewed: false })
    expect(mediaOf(base({ mediaId: 'm1' }))).toBeUndefined() // no key: cannot be opened
    expect(previewText(m)).toBe('View once')
    expect(previewText({ ...m, viewOnce: false })).toBe('Photo: look')
    expect(previewText(base({ mediaId: 'v', mimeType: 'video/mp4', content: '' }))).toBe('Video')
  })

  it('resolves reply quotes and sender names', () => {
    const quoted = base({ id: 1, from: 'me', content: 'orig' })
    const ui = toUiMessage(base({ id: 2, replyToId: 1 }), 'bob', {
      me: 'me', peerReadAt: 0, nameOf: u => u.toUpperCase(), byId: id => (id === 1 ? quoted : undefined),
    })
    expect(ui.replyTo).toEqual({ id: '1', senderName: 'You', text: 'orig' })
    expect(ui.senderName).toBe('BOB')
    expect(ui.fromMe).toBe(false)
  })

  it('prefers the preferred name', () => {
    expect(displayName({ username: 'a', preferredName: ' Ann ' })).toBe('Ann')
    expect(displayName({ username: 'a' })).toBe('a')
  })
})

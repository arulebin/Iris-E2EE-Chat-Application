import type { ChatMessage, UserProfile } from '@iris/core'
import type { Contact, Message, MessageMedia, MessageStatus } from '../services'

/** Pure mapping between the wire/history model of @iris/core and the UI model of services.ts. */

export const displayName = (u: Pick<UserProfile, 'username' | 'preferredName'>): string => u.preferredName?.trim() || u.username

/** Stable UI id: the server id once confirmed, else the client id of an unconfirmed message. */
export const messageKey = (m: ChatMessage): string => (m.id != null ? String(m.id) : `c:${m.clientId ?? m.sentAt}`)

export function statusOf(m: ChatMessage, me: string, peerReadAt: number): MessageStatus {
  if (m.from !== me) return 'read'
  if (m.id == null) return 'sending'
  const sent = Date.parse(m.sentAt)
  if (m.readAt || (peerReadAt > 0 && Number.isFinite(sent) && sent <= peerReadAt)) return 'read'
  return 'sent'
}

export function mediaOf(m: ChatMessage): MessageMedia | undefined {
  if (!m.mediaId || !m.mediaKey) return undefined
  return {
    mediaId: m.mediaId,
    key: m.mediaKey,
    mime: m.mimeType || 'application/octet-stream',
    caption: m.content,
    ...(m.mediaMeta ?? {}),
    viewOnce: !!m.viewOnce,
    viewed: !!m.viewedAt,
  }
}

export interface MapContext {
  me: string
  /** peer -> epoch ms the peer last read my messages (direct chats). */
  peerReadAt: number
  nameOf: (username: string) => string
  /** Looks a replied-to message up by server id. */
  byId: (id: number) => ChatMessage | undefined
}

/** Short preview text for lists and reply quotes. */
export function previewText(m: Pick<ChatMessage, 'content' | 'mediaId' | 'mimeType' | 'mediaKey' | 'viewOnce'>): string {
  if (!m.mediaId) return m.content
  if (m.viewOnce) return 'View once'
  const kind = (m.mimeType ?? '').startsWith('video/') ? 'Video' : (m.mimeType ?? '').startsWith('image/') ? 'Photo' : 'File'
  return m.content ? `${kind}: ${m.content}` : kind
}

export function toUiMessage(m: ChatMessage, chatId: string, c: MapContext): Message {
  const mine = m.from === c.me
  const media = mediaOf(m)
  const replied = m.replyToId != null ? c.byId(m.replyToId) : undefined
  return {
    id: messageKey(m),
    chatId,
    senderId: m.from,
    senderName: mine ? 'You' : c.nameOf(m.from),
    fromMe: mine,
    text: m.content,
    at: Date.parse(m.sentAt) || 0,
    status: statusOf(m, c.me, c.peerReadAt),
    replyTo: replied ? { id: messageKey(replied), senderName: replied.from === c.me ? 'You' : c.nameOf(replied.from), text: previewText(replied) } : undefined,
    media,
  }
}

export function toContact(u: UserProfile, o: { online?: boolean; verified?: boolean; blocked?: boolean; lastSeen?: number } = {}): Contact {
  return {
    id: u.username,
    username: u.username,
    displayName: displayName(u),
    online: !!o.online,
    lastSeen: o.lastSeen,
    verified: !!o.verified,
    blocked: !!o.blocked,
  }
}

/** "iris-safety:v2:<digits>" -> digits (the QR payload carries the number itself). */
export const digitsOfQr = (qr: string): string => qr.replace(/^iris-safety:v\d:/, '')

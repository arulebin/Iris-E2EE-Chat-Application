import { useSyncExternalStore } from 'react'
import type { UploadJob } from './pipeline'
import type { EditedMedia, MediaSource } from './types'

/**
 * Cross-route handoff. Route params only carry short ids; media keys, local file uris and upload jobs live here
 * (in memory), so nothing sensitive ends up in navigation state or deep links.
 */

// ---- drafts (camera / picker -> preview) ---------------------------------------------------------------------------

export interface MediaDraft {
  id: string
  conversationId: string
  items: MediaSource[]
  /** Pre-fill / default for the view-once toggle (e.g. camera opened in "snap" mode). */
  viewOnceDefault: boolean
  /** Allow the view-once toggle at all (groups: no, mirrors web `allowSnaps`). */
  allowViewOnce: boolean
  /** Origin of the flow; the preview's "add more" button returns here. */
  source: 'camera' | 'picker' | 'document'
}

const drafts = new Map<string, MediaDraft>()
let seq = 0
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

export function createDraft(d: Omit<MediaDraft, 'id'>): string {
  const id = nextId('d')
  drafts.set(id, { ...d, id })
  return id
}
export const getDraft = (id: string | undefined): MediaDraft | undefined => (id ? drafts.get(id) : undefined)
export function updateDraft(id: string, patch: Partial<MediaDraft>): void {
  const d = drafts.get(id)
  if (d) drafts.set(id, { ...d, ...patch })
}
export function discardDraft(id: string | undefined): void {
  if (id) drafts.delete(id)
}

// ---- send handler (preview -> messaging layer) ---------------------------------------------------------------------

/** One attachment being sent. The messaging layer renders an optimistic bubble from it and sends once `job.done()` resolves. */
export interface OutgoingMedia {
  id: string
  conversationId: string
  item: EditedMedia
  caption: string
  viewOnce: boolean
  /** Upload in progress (progress/cancel/retry). Await `job.done()`, then send `job.envelope(caption)`. */
  job: UploadJob
}

export type MediaSendHandler = (outgoing: OutgoingMedia[]) => void | Promise<void>

let sendHandler: MediaSendHandler | null = null

/**
 * The messaging layer registers this once. It is invoked from the preview screen when the user taps send.
 * Typical implementation:
 *
 *   registerMediaSendHandler(async items => {
 *     for (const o of items) {
 *       const optimisticId = state.addPending(o)                      // render <MediaBubble pending={o} />
 *       o.job.done().then(async up => {
 *         await messaging.sendEncrypted(o.conversationId, o.job.envelope(o.caption),
 *           { mediaId: up.mediaId, mimeType: up.wireMimeType, viewOnce: o.viewOnce })
 *         o.job.dispose()
 *       }).catch(() => state.markFailed(optimisticId))                // user can call o.job.retry()
 *     }
 *   })
 */
export function registerMediaSendHandler(h: MediaSendHandler | null): void {
  sendHandler = h
}
export async function dispatchOutgoing(o: OutgoingMedia[]): Promise<void> {
  if (!sendHandler) throw new Error('registerMediaSendHandler() has not been called')
  await sendHandler(o)
}

// ---- viewer sessions -----------------------------------------------------------------------------------------------

export interface ViewerItem {
  /** Stable key (message id). */
  key: string
  mediaId: string
  /** base64 AES key from the envelope. */
  mediaKey: string
  mime: string
  name?: string
  caption?: string
  width?: number
  height?: number
  blurhash?: string
  duration?: number
  viewOnce?: boolean
  /** True for messages we sent: view-once items cannot be opened by the sender. */
  mine?: boolean
  /** Already-decrypted local copy (skips the download for normal media). */
  localUri?: string
  /** Called when a view-once item has been consumed (viewer opened it), so the host can mark the message viewed. */
  onViewed?: () => void
}

export interface ViewerOrigin {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewerSession {
  id: string
  items: ViewerItem[]
  index: number
  origin?: ViewerOrigin
}

const viewers = new Map<string, ViewerSession>()
export function createViewerSession(s: Omit<ViewerSession, 'id'>): string {
  const id = nextId('v')
  viewers.set(id, { ...s, id })
  return id
}
export const getViewerSession = (id: string | undefined): ViewerSession | undefined => (id ? viewers.get(id) : undefined)
export function endViewerSession(id: string | undefined): void {
  if (id) viewers.delete(id)
}

// ---- tiny external store for per-job status in React ----------------------------------------------------------------

import type { TransferStatus } from './types'

export function useUploadStatus(job: UploadJob | undefined): TransferStatus {
  return useSyncExternalStore(
    cb => (job ? job.subscribe(cb) : () => {}),
    () => job?.status ?? IDLE,
    () => IDLE,
  )
}
const IDLE: TransferStatus = { state: 'idle', progress: 0 }

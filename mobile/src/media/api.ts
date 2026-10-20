import { router, useNavigation } from 'expo-router'
import { useCallback } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { createDraft, createViewerSession, type ViewerItem, type ViewerOrigin } from './session'
import { guessMime, kindFromMime } from './helpers'
import { randomId } from './files'
import type { MediaSource } from './types'

export interface OpenMediaOptions {
  /** Offer the view-once toggle (default true; pass false in group chats like web's `allowSnaps={false}`). */
  allowViewOnce?: boolean
  /** Start with view-once armed (Snapchat-style "snap" entry point). */
  viewOnce?: boolean
}

// expo-router typed routes are generated at dev-server time; route strings here are static and valid.
const go = (pathname: string, params: Record<string, string>) => router.push({ pathname, params } as never)

/** Full-screen camera. Capture -> preview/editor -> send handler. */
export function openCamera(conversationId: string, opts: OpenMediaOptions = {}): void {
  go('/media/camera', {
    conversationId,
    allowViewOnce: opts.allowViewOnce === false ? '0' : '1',
    viewOnce: opts.viewOnce ? '1' : '0',
  })
}

/** WhatsApp-style gallery grid (multi-select up to 30, albums, durations). */
export function openPicker(conversationId: string, opts: OpenMediaOptions = {}): void {
  go('/media/picker', {
    conversationId,
    allowViewOnce: opts.allowViewOnce === false ? '0' : '1',
    viewOnce: opts.viewOnce ? '1' : '0',
  })
}

/** System document picker; picked files go straight to the confirm/caption screen. */
export async function openDocumentPicker(conversationId: string, opts: OpenMediaOptions = {}): Promise<void> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true })
  if (res.canceled || res.assets.length === 0) return
  const items: MediaSource[] = res.assets.slice(0, 30).map(a => {
    const mime = a.mimeType ?? guessMime(a.name)
    return { id: randomId(4), kind: kindFromMime(mime) === 'file' ? 'file' : kindFromMime(mime), uri: a.uri, mime, name: a.name, size: a.size }
  })
  openPreviewWith(conversationId, items, 'document', opts)
}

/** Internal: camera/picker hand their result to the preview through a draft. */
export function openPreviewWith(
  conversationId: string,
  items: MediaSource[],
  source: 'camera' | 'picker' | 'document',
  opts: OpenMediaOptions = {},
  replace = false,
): void {
  const draftId = createDraft({
    conversationId,
    items,
    source,
    allowViewOnce: opts.allowViewOnce !== false,
    viewOnceDefault: !!opts.viewOnce,
  })
  const target = { pathname: '/media/preview', params: { draftId } } as never
  if (replace) router.replace(target)
  else router.push(target)
}

/** Open the full-screen viewer for a list of media messages (swipe between items). */
export function openViewer(items: ViewerItem[], startIndex = 0, origin?: ViewerOrigin): void {
  if (items.length === 0) return
  const sid = createViewerSession({ items, index: startIndex, origin })
  go('/media/viewer', { sid, i: String(startIndex) })
}

/** Pop the whole media flow (camera/picker/preview) back to the chat. Use inside media screens. */
export function useCloseMediaFlow(): () => void {
  const nav = useNavigation()
  return useCallback(() => {
    const parent = nav.getParent()
    if (parent?.canGoBack()) parent.goBack()
    else if (router.canGoBack()) router.back()
  }, [nav])
}

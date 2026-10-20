import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { createVideoThumbnail } from 'react-native-compressor'
import { useTheme } from '@/theme'
import { openViewer } from '../api'
import { bubbleSize, extensionOf, formatBytes, formatDuration, kindFromMime } from '../helpers'
import { downloadMedia, getCachedMedia, MediaError, shareLocalFile, type LocalMedia } from '../pipeline'
import { useUploadStatus, type OutgoingMedia, type ViewerItem } from '../session'
import type { MediaEnvelope } from '../types'
import { useViewOnceState } from '../viewOnceStore'
import { ProgressRing } from './ProgressRing'

export interface MediaBubbleProps {
  /** Stable message key (also used as the viewer key). */
  messageKey: string
  /** Server media id from the message (`mediaId`). */
  mediaId: string
  /** Parsed envelope (`parseMediaEnvelope(decryptedText)`). */
  envelope: MediaEnvelope
  /** Message-level flag from the wire message (`viewOnce`). */
  viewOnce?: boolean
  /** True for messages sent by me. */
  mine: boolean
  /** Sender-side optimistic state: while set, the bubble shows the local file with upload progress / cancel / retry. */
  pending?: OutgoingMedia
  /** Max bubble width in dp (default 260). */
  maxWidth?: number
  /** Siblings for swipe-through in the viewer (non view-once). Include this message too; `index` points at it. */
  gallery?: ViewerItem[]
  galleryIndex?: number
  /** Fired when a view-once item has been consumed so the host can persist "viewed" on the message. */
  onViewed?: () => void
  /** Auto-download photos when the bubble mounts (default true; videos/docs always tap-to-download). */
  autoDownloadImages?: boolean
  style?: StyleProp<ViewStyle>
}

export function toViewerItem(p: Pick<MediaBubbleProps, 'messageKey' | 'mediaId' | 'envelope' | 'viewOnce' | 'mine' | 'onViewed'>): ViewerItem {
  const e = p.envelope
  return {
    key: p.messageKey,
    mediaId: p.mediaId,
    mediaKey: e.key,
    mime: e.mime,
    name: e.name,
    caption: e.caption,
    width: e.w,
    height: e.h,
    blurhash: e.bh,
    duration: e.dur,
    viewOnce: p.viewOnce,
    mine: p.mine,
    onViewed: p.onViewed,
  }
}

function useDownload(p: MediaBubbleProps, enabled: boolean) {
  const e = p.envelope
  const ref = { mediaId: p.mediaId, key: e.key, mime: e.mime, name: e.name }
  const [local, setLocal] = useState<LocalMedia | null>(() => (p.viewOnce ? null : getCachedMedia(ref)))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const start = useCallback(async () => {
    if (started.current) return
    started.current = true
    setBusy(true)
    setError(null)
    try {
      const l = await downloadMedia(ref, { onProgress: setProgress })
      setLocal(l)
    } catch (err) {
      setError(err instanceof MediaError ? err.message : 'Download failed')
      started.current = false
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mediaId, e.key])

  useEffect(() => {
    if (enabled && !local && !p.viewOnce) void start()
  }, [enabled, local, p.viewOnce, start])

  return { local, busy, progress, error, start }
}

export function MediaBubble(props: MediaBubbleProps) {
  const { envelope: e, mine, pending, maxWidth = 260 } = props
  const kind = kindFromMime(e.mime)
  if (props.viewOnce) return <ViewOnceBubble {...props} kind={kind} />
  if (kind === 'file') return <DocumentBubble {...props} />
  return <ThumbBubble {...props} kind={kind} maxWidth={maxWidth} mine={mine} pending={pending} />
}

// ---------------------------------------------------------------------------------------------------------------------

function ThumbBubble(props: MediaBubbleProps & { kind: 'image' | 'video' }) {
  const t = useTheme()
  const { envelope: e, kind, pending, maxWidth = 260 } = props
  const dl = useDownload(props, !pending && (kind === 'image' ? props.autoDownloadImages !== false : false))
  const up = useUploadStatus(pending?.job)
  const viewRef = useRef<ComponentRef<typeof View>>(null)
  const [poster, setPoster] = useState<string | null>(null)

  const pw = pending?.job.preview?.width ?? pending?.item.width
  const ph = pending?.job.preview?.height ?? pending?.item.height
  const size = bubbleSize(pw ?? e.w, ph ?? e.h, maxWidth)
  const localThumb = pending ? (pending.job.preview?.thumbUri ?? (pending.item.kind === 'image' ? pending.item.uri : undefined)) : undefined

  // Video poster from the cached decrypted file.
  useEffect(() => {
    if (kind !== 'video' || !dl.local || poster) return
    let alive = true
    createVideoThumbnail(dl.local.uri, { quality: 0.6 })
      .then(r => alive && setPoster(r.path.startsWith('file://') ? r.path : `file://${r.path}`))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [kind, dl.local, poster])

  const shown = localThumb ?? (kind === 'image' ? dl.local?.uri : poster) ?? undefined

  const open = () => {
    if (pending) return
    if (dl.error && kind === 'image') return void dl.start()
    const items = props.gallery ?? [toViewerItem(props)]
    const idx = props.gallery ? (props.galleryIndex ?? 0) : 0
    viewRef.current?.measureInWindow((x, y, width, height) => {
      openViewer(items, idx, width > 0 ? { x, y, width, height } : undefined)
    })
  }

  const uploading = !!pending && (up.state === 'preparing' || up.state === 'encrypting' || up.state === 'uploading')
  const failed = !!pending && (up.state === 'error' || up.state === 'cancelled')
  const downloading = !pending && dl.busy && !dl.local

  return (
    <View style={props.style}>
      <View ref={viewRef} collapsable={false} style={size}>
      <Pressable onPress={open} style={[styles.media, size]} accessibilityRole="imagebutton" accessibilityLabel={kind === 'video' ? 'Video' : 'Photo'}>
        {shown ? (
          <Image source={{ uri: shown }} placeholder={e.bh ? { blurhash: e.bh } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={props.mediaId} />
        ) : e.bh ? (
          <Image source={{ blurhash: e.bh }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.hairline }]} />
        )}

        {kind === 'video' && !uploading && !downloading && (
          <View style={styles.centerFill}>
            <View style={styles.playBtn}>
              <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
            </View>
          </View>
        )}
        {kind === 'video' && (
          <View style={styles.badgeBL}>
            <Ionicons name="videocam" size={12} color="#fff" />
            <Text style={styles.badgeText}>
              {e.dur != null ? formatDuration(e.dur) : ''}
              {e.dur != null && e.size != null ? '  ·  ' : ''}
              {e.size != null && !dl.local ? formatBytes(e.size) : ''}
            </Text>
          </View>
        )}

        {(uploading || downloading) && (
          <View style={styles.centerFill}>
            <View style={styles.ringBg}>
              <ProgressRing size={48} stroke={3.5} progress={uploading ? up.progress || undefined : dl.progress || undefined}>
                {uploading ? (
                  <Pressable onPress={() => pending?.job.cancel()} hitSlop={10} accessibilityLabel="Cancel upload">
                    <Ionicons name="close" size={22} color="#fff" />
                  </Pressable>
                ) : (
                  <Ionicons name="arrow-down" size={20} color="#fff" />
                )}
              </ProgressRing>
            </View>
          </View>
        )}

        {failed && (
          <Pressable style={styles.centerFill} onPress={() => void pending?.job.retry().catch(() => {})} accessibilityLabel="Retry upload">
            <View style={styles.ringBg}>
              <Ionicons name="refresh" size={26} color="#fff" />
            </View>
            <Text style={styles.errText}>{up.error ?? 'Tap to retry'}</Text>
          </Pressable>
        )}

        {!pending && dl.error && !dl.busy && !dl.local && kind === 'image' && (
          <Pressable style={styles.centerFill} onPress={() => void dl.start()} accessibilityLabel="Retry download">
            <View style={styles.ringBg}>
              <Ionicons name="refresh" size={26} color="#fff" />
            </View>
          </Pressable>
        )}
      </Pressable>
      </View>
      {!!e.caption && (
        <Text style={[styles.caption, { color: t.ink, width: size.width }]}>{e.caption}</Text>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

function ViewOnceBubble(props: MediaBubbleProps & { kind: 'image' | 'video' | 'file' }) {
  const t = useTheme()
  const { envelope: e, mine, kind, pending } = props
  const state = useViewOnceState(props.mediaId)
  const up = useUploadStatus(pending?.job)
  const noun = kind === 'video' ? 'Video' : kind === 'image' ? 'Photo' : 'File'

  let label = noun
  let sub = 'Tap to view'
  let tone: 'live' | 'dim' = 'live'
  if (mine) {
    label = noun
    sub = pending && up.state !== 'done' ? (up.state === 'error' ? 'Failed. Tap to retry' : 'Sending…') : 'View once · sent'
    tone = 'dim'
  } else if (state === 'opened') {
    label = 'Opened'
    sub = noun
    tone = 'dim'
  } else if (state === 'expired') {
    label = 'Expired'
    sub = noun
    tone = 'dim'
  }

  const onPress = () => {
    if (pending && (up.state === 'error' || up.state === 'cancelled')) return void pending.job.retry().catch(() => {})
    if (mine || state !== 'unopened') return
    openViewer([toViewerItem(props)], 0)
  }

  const color = tone === 'live' ? t.primary : t.muted
  const sending = !!pending && (up.state === 'preparing' || up.state === 'encrypting' || up.state === 'uploading')

  return (
    <Pressable onPress={onPress} style={[styles.once, props.style]} accessibilityRole="button" accessibilityLabel={`${label} ${sub}`}>
      {sending ? (
        <ProgressRing size={36} stroke={3} color={t.primary} track={t.hairline} progress={up.progress || undefined}>
          <Ionicons name="arrow-up" size={16} color={t.primary} />
        </ProgressRing>
      ) : (
        <View style={[styles.onceIcon, { borderColor: color, borderStyle: tone === 'live' ? 'solid' : 'dashed' }]}>
          <Text style={[styles.onceOne, { color }]}>1</Text>
        </View>
      )}
      <View style={{ flexShrink: 1 }}>
        <Text style={[styles.onceLabel, { color: tone === 'live' ? t.ink : t.muted }]}>{label}</Text>
        <Text style={[styles.onceSub, { color: t.muted }]}>{sub}</Text>
      </View>
      {tone === 'live' && !sending && <Ionicons name={kind === 'video' ? 'videocam' : 'image'} size={18} color={color} />}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

function DocumentBubble(props: MediaBubbleProps) {
  const t = useTheme()
  const { envelope: e, pending } = props
  const dl = useDownload(props, false)
  const up = useUploadStatus(pending?.job)
  const name = e.name ?? pending?.item.name ?? 'Document'
  const ext = (extensionOf(name) || 'file').slice(0, 4).toUpperCase()
  const size = e.size ?? pending?.item.size

  const onPress = async () => {
    if (pending) {
      if (up.state === 'error' || up.state === 'cancelled') void pending.job.retry().catch(() => {})
      return
    }
    if (dl.busy) return
    const l = dl.local ?? (await downloadMedia({ mediaId: props.mediaId, key: e.key, mime: e.mime, name: e.name }).catch(() => null))
    if (l) await shareLocalFile(l).catch(() => {})
    else void dl.start()
  }

  const uploading = !!pending && (up.state === 'preparing' || up.state === 'encrypting' || up.state === 'uploading')
  return (
    <Pressable onPress={() => void onPress()} style={[styles.doc, props.style]} accessibilityRole="button" accessibilityLabel={`Document ${name}`}>
      <View style={[styles.docIcon, { backgroundColor: t.primary }]}>
        <Ionicons name="document-text" size={22} color="#fff" />
        <Text style={styles.docExt}>{ext}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.docName, { color: t.ink }]} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[styles.docMeta, { color: t.muted }]}>
          {size != null ? formatBytes(size) : ''}
          {dl.error ? '  ·  Failed, tap to retry' : up.state === 'error' ? '  ·  Failed, tap to retry' : ''}
        </Text>
        {!!e.caption && <Text style={[styles.docCaption, { color: t.ink }]}>{e.caption}</Text>}
      </View>
      {uploading || dl.busy ? (
        <ProgressRing size={36} stroke={3} color={t.primary} track={t.hairline} progress={(uploading ? up.progress : dl.progress) || undefined}>
          {uploading ? (
            <Pressable onPress={() => pending?.job.cancel()} hitSlop={8}>
              <Ionicons name="close" size={16} color={t.primary} />
            </Pressable>
          ) : (
            <ActivityIndicator size="small" color={t.primary} />
          )}
        </ProgressRing>
      ) : (
        <Ionicons name={dl.local || pending ? 'open-outline' : 'download-outline'} size={24} color={t.primary} />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  media: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#1a1d26' },
  centerFill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  ringBg: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 32, padding: 6, alignItems: 'center', justifyContent: 'center' },
  badgeBL: { position: 'absolute', left: 8, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3 },
  errText: { color: '#fff', fontSize: 12, marginTop: 6, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3 },
  caption: { fontSize: 15, lineHeight: 20, paddingTop: 6 },
  once: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, paddingRight: 4, minWidth: 150 },
  onceIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  onceOne: { fontSize: 15, fontWeight: '800' },
  onceLabel: { fontSize: 15, fontWeight: '700' },
  onceSub: { fontSize: 12 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 220, maxWidth: 280, paddingVertical: 2 },
  docIcon: { width: 44, height: 52, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  docExt: { color: '#fff', fontSize: 9, fontWeight: '800', marginTop: 1 },
  docName: { fontSize: 15, fontWeight: '600' },
  docMeta: { fontSize: 12, marginTop: 2 },
  docCaption: { fontSize: 14, marginTop: 4 },
})

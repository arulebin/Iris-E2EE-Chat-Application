import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import * as MediaLibrary from 'expo-media-library'
import { useLocalSearchParams } from 'expo-router'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { openDocumentPicker, openPreviewWith, useCloseMediaFlow } from '@/media/api'
import { formatDuration, guessMime } from '@/media/helpers'
import { MAX_SELECTION } from '@/media/limits'
import type { MediaSource } from '@/media/types'
import { PermissionGate } from '@/media/ui/PermissionGate'

const PAGE = 90
const GAP = 2
const COLS = 3

type Meta = MediaLibrary.AssetMetadata
interface AlbumEntry {
  key: string
  title: string
  count: number | null
  album: MediaLibrary.Album | null
}

const Cell = memo(function Cell(props: {
  meta: Meta
  size: number
  order: number // 0 = not selected
  selecting: boolean
  onPress: (m: Meta) => void
  onLongPress: (m: Meta) => void
  onToggle: (m: Meta) => void
}) {
  const { meta, size, order, selecting } = props
  const [uri, setUri] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    new MediaLibrary.Asset(meta.id)
      .getUri()
      .then(u => alive && setUri(u))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [meta.id])
  const isVideo = meta.mediaType === MediaLibrary.MediaType.VIDEO
  return (
    <Pressable
      onPress={() => props.onPress(meta)}
      onLongPress={() => props.onLongPress(meta)}
      delayLongPress={250}
      style={{ width: size, height: size, backgroundColor: '#1a1d26' }}
      accessibilityLabel={isVideo ? 'Video' : 'Photo'}
    >
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={meta.id} transition={80} /> : null}
      {order > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(91,91,214,0.35)' }]} />}
      {isVideo && (
        <View style={styles.dur}>
          <Ionicons name="videocam" size={12} color="#fff" />
          {meta.duration != null && <Text style={styles.durText}>{formatDuration(meta.duration)}</Text>}
        </View>
      )}
      <Pressable onPress={() => props.onToggle(meta)} hitSlop={6} style={styles.badgeHit}>
        <View style={[styles.badge, order > 0 ? styles.badgeOn : selecting ? styles.badgeIdle : styles.badgeFaint]}>
          {order > 0 ? <Text style={styles.badgeText}>{order}</Text> : null}
        </View>
      </Pressable>
    </Pressable>
  )
})

export default function PickerScreen() {
  const params = useLocalSearchParams<{ conversationId: string; allowViewOnce?: string; viewOnce?: string }>()
  const close = useCloseMediaFlow()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const size = Math.floor((width - GAP * (COLS - 1)) / COLS)

  const [perm, requestPerm] = MediaLibrary.usePermissions({ granularPermissions: ['photo', 'video'] })
  const [albums, setAlbums] = useState<AlbumEntry[]>([{ key: 'recents', title: 'Recent', count: null, album: null }])
  const [albumKey, setAlbumKey] = useState('recents')
  const [items, setItems] = useState<Meta[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [picking, setPicking] = useState(false)
  const [albumMenu, setAlbumMenu] = useState(false)
  const [selected, setSelected] = useState<Meta[]>([]) // order = index + 1
  const [resolving, setResolving] = useState(false)
  const offset = useRef(0)
  const gen = useRef(0)

  const selecting = selected.length > 0
  const orderOf = useMemo(() => new Map(selected.map((m, i) => [m.id, i + 1])), [selected])
  const album = albums.find(a => a.key === albumKey)?.album ?? null

  const granted = perm?.granted ?? false

  // albums list
  useEffect(() => {
    if (!granted) return
    let alive = true
    ;(async () => {
      try {
        const all = await MediaLibrary.Album.getAll()
        const entries = await Promise.all(
          all.map(async (a): Promise<AlbumEntry> => ({
            key: a.id,
            title: await a.getTitle().catch(() => 'Album'),
            count: await a.getAssetCount().catch(() => 0),
            album: a,
          })),
        )
        if (!alive) return
        setAlbums([
          { key: 'recents', title: 'Recent', count: null, album: null },
          ...entries.filter(e => (e.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
        ])
      } catch {
        // albums are optional
      }
    })()
    return () => {
      alive = false
    }
  }, [granted])

  const loadMore = useCallback(async () => {
    if (!granted || loading || done) return
    const my = gen.current
    setLoading(true)
    try {
      let q = new MediaLibrary.Query()
        .within(MediaLibrary.AssetField.MEDIA_TYPE, [MediaLibrary.MediaType.IMAGE, MediaLibrary.MediaType.VIDEO])
        .orderBy({ key: MediaLibrary.AssetField.CREATION_TIME, ascending: false })
        .limit(PAGE)
        .offset(offset.current)
      if (album) q = q.album(album)
      const page = await q.exeForMetadata()
      if (my !== gen.current) return
      offset.current += page.length
      setItems(prev => prev.concat(page))
      if (page.length < PAGE) setDone(true)
    } catch {
      if (my === gen.current) setDone(true)
    } finally {
      if (my === gen.current) setLoading(false)
    }
  }, [granted, loading, done, album])

  // reset + first page when permission / album changes
  useEffect(() => {
    gen.current++
    offset.current = 0
    setItems([])
    setDone(false)
    setLoading(false)
  }, [granted, albumKey])
  useEffect(() => {
    if (granted && items.length === 0 && !loading && !done) void loadMore()
  }, [granted, items.length, loading, done, loadMore])

  const toggle = useCallback((m: Meta) => {
    setSelected(prev => {
      const i = prev.findIndex(p => p.id === m.id)
      if (i >= 0) return prev.filter(p => p.id !== m.id)
      if (prev.length >= MAX_SELECTION) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        return prev
      }
      void Haptics.selectionAsync()
      return [...prev, m]
    })
  }, [])

  const toSources = useCallback(async (metas: Meta[]): Promise<MediaSource[]> => {
    return Promise.all(
      metas.map(async (m): Promise<MediaSource> => {
        const uri = await new MediaLibrary.Asset(m.id).getUri()
        const video = m.mediaType === MediaLibrary.MediaType.VIDEO
        const name = m.filename ?? undefined
        return {
          id: m.id,
          kind: video ? 'video' : 'image',
          uri,
          mime: name ? guessMime(name, video ? 'video/mp4' : 'image/jpeg') : video ? 'video/mp4' : 'image/jpeg',
          name,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
          duration: m.duration ?? undefined,
        }
      }),
    )
  }, [])

  const proceed = useCallback(
    async (metas: Meta[]) => {
      if (metas.length === 0 || resolving) return
      setResolving(true)
      try {
        const sources = await toSources(metas)
        openPreviewWith(String(params.conversationId ?? ''), sources, 'picker', {
          allowViewOnce: params.allowViewOnce !== '0',
          viewOnce: params.viewOnce === '1',
        })
      } finally {
        setResolving(false)
      }
    },
    [resolving, toSources, params.conversationId, params.allowViewOnce, params.viewOnce],
  )

  const onPress = useCallback((m: Meta) => (selecting ? toggle(m) : void proceed([m])), [selecting, toggle, proceed])
  const onLongPress = useCallback((m: Meta) => toggle(m), [toggle])

  if (perm && !granted) {
    return (
      <PermissionGate
        icon="images"
        title="Share photos and videos"
        body="Allow access to your photos so you can pick what to send. Iris only reads what you select, and never uploads anything without your tap."
        blocked={!perm.canAskAgain}
        onAllow={() => void requestPerm()}
        onClose={close}
        allowLabel="Allow access"
      />
    )
  }

  const currentTitle = albums.find(a => a.key === albumKey)?.title ?? 'Recent'

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={close} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Pressable onPress={() => setAlbumMenu(true)} style={styles.albumBtn} accessibilityRole="button" accessibilityLabel="Choose album">
          <Text style={styles.title} numberOfLines={1}>
            {selecting ? `${selected.length} selected` : currentTitle}
          </Text>
          {!selecting && <Ionicons name="chevron-down" size={18} color="#fff" />}
        </Pressable>
        <Pressable
          onPress={async () => {
            if (picking) return
            setPicking(true)
            try {
              await openDocumentPicker(String(params.conversationId ?? ''), {
                allowViewOnce: false,
              })
            } finally {
              setPicking(false)
            }
          }}
          hitSlop={12}
          style={styles.docBtn}
          accessibilityLabel="Send a document"
        >
          <Ionicons name="document-text-outline" size={20} color="#fff" />
          <Text style={styles.docText}>Document</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={m => m.id}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP }}
        ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
        renderItem={({ item }) => (
          <Cell
            meta={item}
            size={size}
            order={orderOf.get(item.id) ?? 0}
            selecting={selecting}
            onPress={onPress}
            onLongPress={onLongPress}
            onToggle={toggle}
          />
        )}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={1.5}
        initialNumToRender={30}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: insets.bottom + (selecting ? 96 : 12) }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>No photos or videos here yet</Text>
          )
        }
        ListFooterComponent={loading && items.length > 0 ? <ActivityIndicator color="#fff" style={{ margin: 16 }} /> : undefined}
      />

      {selecting && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={() => setSelected([])} hitSlop={8}>
            <Text style={styles.barClear}>Clear</Text>
          </Pressable>
          <Text style={styles.barCount}>
            {selected.length} / {MAX_SELECTION}
          </Text>
          <Pressable
            onPress={() => void proceed(selected)}
            style={styles.send}
            disabled={resolving}
            accessibilityRole="button"
            accessibilityLabel={`Continue with ${selected.length} items`}
          >
            {resolving ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-forward" size={24} color="#fff" />}
          </Pressable>
        </View>
      )}

      <Modal visible={albumMenu} transparent animationType="fade" onRequestClose={() => setAlbumMenu(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAlbumMenu(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <Text style={styles.sheetTitle}>Albums</Text>
            <FlatList
              data={albums}
              keyExtractor={a => a.key}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setAlbumKey(item.key)
                    setAlbumMenu(false)
                  }}
                  style={styles.sheetRow}
                >
                  <Text style={[styles.sheetRowText, item.key === albumKey && { color: '#9d7bff' }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.count != null && <Text style={styles.sheetCount}>{item.count}</Text>}
                </Pressable>
              )}
            />
            {Platform_isPartial(perm) && (
              <Pressable onPress={() => void MediaLibrary.presentPermissionsPicker(['photo', 'video'])} style={styles.sheetRow}>
                <Text style={[styles.sheetRowText, { color: '#9d7bff' }]}>Manage selected photos</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

/** Android 14+/iOS 14+ "selected photos only" access. */
function Platform_isPartial(p: unknown): boolean {
  const a = (p as { accessPrivileges?: string } | null)?.accessPrivileges
  return a === 'limited'
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0d12' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  albumBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { color: '#fff', fontSize: 19, fontWeight: '700', flexShrink: 1 },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1d212c', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  docText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  dur: { position: 'absolute', left: 6, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  durText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 3 },
  badgeHit: { position: 'absolute', top: 0, right: 0, padding: 6 },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeFaint: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(0,0,0,0.15)' },
  badgeIdle: { borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)' },
  badgeOn: { backgroundColor: '#5b5bd6', borderWidth: 2, borderColor: '#fff' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { color: '#8b93a3', textAlign: 'center', marginTop: 60 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'rgba(11,13,18,0.96)' },
  barClear: { color: '#9d7bff', fontSize: 15, fontWeight: '600' },
  barCount: { color: '#fff', fontSize: 15, fontWeight: '600' },
  send: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#5b5bd6', alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#161922', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingTop: 12 },
  sheetTitle: { color: '#8b93a3', fontSize: 13, fontWeight: '700', paddingHorizontal: 20, paddingBottom: 6, textTransform: 'uppercase' },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  sheetRowText: { color: '#fff', fontSize: 16, flex: 1 },
  sheetCount: { color: '#8b93a3', fontSize: 14, marginLeft: 12 },
})

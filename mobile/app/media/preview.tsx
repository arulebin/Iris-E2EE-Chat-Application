import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { useVideoPlayer, VideoView } from 'expo-video'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useCloseMediaFlow } from '@/media/api'
import { formatBytes, formatDuration } from '@/media/helpers'
import { randomId } from '@/media/files'
import { UploadJob } from '@/media/pipeline'
import { discardDraft, dispatchOutgoing, getDraft, type OutgoingMedia } from '@/media/session'
import type { EditedMedia, MediaSource } from '@/media/types'
import { CropModal } from '@/media/ui/CropModal'

interface Slot extends MediaSource {
  caption: string
  viewOnce: boolean
}

function FileCard({ item }: { item: Slot }) {
  const ext = (item.name?.split('.').pop() ?? 'file').slice(0, 4).toUpperCase()
  return (
    <View style={styles.fileWrap}>
      <View style={styles.fileIcon}>
        <Ionicons name="document-text" size={52} color="#fff" />
        <Text style={styles.fileExt}>{ext}</Text>
      </View>
      <Text style={styles.fileName} numberOfLines={3}>
        {item.name ?? 'Document'}
      </Text>
      {item.size != null && <Text style={styles.fileSize}>{formatBytes(item.size)}</Text>}
    </View>
  )
}

function PreviewVideo({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri, p => {
    p.loop = true
  })
  useEffect(() => {
    if (active) player.play()
    else player.pause()
  }, [active, player])
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
}

export default function PreviewScreen() {
  const { draftId } = useLocalSearchParams<{ draftId: string }>()
  const draft = getDraft(draftId)
  const close = useCloseMediaFlow()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  const [slots, setSlots] = useState<Slot[]>(() =>
    (draft?.items ?? []).map(i => ({ ...i, caption: '', viewOnce: !!draft?.viewOnceDefault && i.kind !== 'file' && draft.allowViewOnce })),
  )
  const [index, setIndex] = useState(0)
  const [hd, setHd] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<FlatList<Slot>>(null)

  const current = slots[index]
  const hasImages = slots.some(s => s.kind === 'image')
  const canViewOnce = !!draft?.allowViewOnce && current?.kind !== 'file'

  useEffect(() => {
    if (!draft) router.back()
  }, [draft])

  const patch = useCallback((i: number, p: Partial<Slot>) => {
    setSlots(prev => prev.map((s, k) => (k === i ? { ...s, ...p } : s)))
  }, [])

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
  }
  const goTo = (i: number) => {
    listRef.current?.scrollToIndex({ index: i, animated: true })
    setIndex(i)
  }

  const remove = () => {
    if (slots.length <= 1) return close()
    const next = slots.filter((_, i) => i !== index)
    setSlots(next)
    setIndex(Math.max(0, Math.min(index, next.length - 1)))
  }

  const applyEdit = async (actions: Parameters<typeof manipulateAsync>[1]) => {
    if (!current || current.kind !== 'image' || busy) return
    setBusy(true)
    try {
      const keepsAlpha = current.mime === 'image/png' || current.mime === 'image/webp'
      const out = await manipulateAsync(current.uri, actions, {
        compress: 0.95,
        format: keepsAlpha ? SaveFormat.PNG : SaveFormat.JPEG,
      })
      patch(index, {
        uri: out.uri,
        width: out.width,
        height: out.height,
        mime: keepsAlpha ? 'image/png' : 'image/jpeg',
      })
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!draft || busy || slots.length === 0) return
    setBusy(true)
    try {
      const outgoing: OutgoingMedia[] = slots.map(s => {
        const item: EditedMedia = {
          id: s.id,
          kind: s.kind,
          uri: s.uri,
          mime: s.mime,
          name: s.name,
          width: s.width,
          height: s.height,
          duration: s.duration,
          size: s.size,
          caption: s.caption.trim(),
          viewOnce: s.viewOnce && s.kind !== 'file' && draft.allowViewOnce,
          hd: hd && s.kind === 'image',
        }
        return {
          id: randomId(6),
          conversationId: draft.conversationId,
          item,
          caption: item.caption,
          viewOnce: item.viewOnce,
          job: new UploadJob(item),
        }
      })
      await dispatchOutgoing(outgoing)
      discardDraft(draft.id)
      close()
    } catch (e) {
      setBusy(false)
      console.warn('[media] send failed', e)
    }
  }

  const renderItem = useMemo(
    () =>
      function Item({ item, index: i }: { item: Slot; index: number }) {
        return (
          <View style={{ width, height: '100%' }}>
            {item.kind === 'image' ? (
              <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            ) : item.kind === 'video' ? (
              <PreviewVideo uri={item.uri} active={i === index} />
            ) : (
              <FileCard item={item} />
            )}
          </View>
        )
      },
    [width, index],
  )

  if (!draft || !current) return <View style={styles.root} />

  return (
    <GestureHandlerRootView style={styles.root}>
      <FlatList
        ref={listRef}
        data={slots}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={s => s.id}
        renderItem={({ item, index: i }) => renderItem({ item, index: i })}
        onMomentumScrollEnd={onScrollEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        extraData={index}
        style={StyleSheet.absoluteFill}
      />

      {/* top bar */}
      <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={styles.roundBtn} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.topRight}>
          {current.kind === 'image' && (
            <>
              <Pressable onPress={() => void applyEdit([{ rotate: 90 }])} style={styles.roundBtn} accessibilityLabel="Rotate">
                <Ionicons name="refresh" size={22} color="#fff" style={{ transform: [{ scaleX: -1 }] }} />
              </Pressable>
              <Pressable
                onPress={() => setCropping(true)}
                style={styles.roundBtn}
                accessibilityLabel="Crop"
                disabled={!current.width || !current.height}
              >
                <Ionicons name="crop" size={22} color="#fff" />
              </Pressable>
            </>
          )}
          {hasImages && (
            <Pressable onPress={() => setHd(v => !v)} style={[styles.pill, hd && styles.pillOn]} accessibilityLabel="High quality">
              <Text style={styles.pillText}>HD</Text>
            </Pressable>
          )}
          {slots.length > 1 && (
            <Pressable onPress={remove} style={styles.roundBtn} accessibilityLabel="Remove">
              <Ionicons name="trash-outline" size={22} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>

      {current.kind === 'video' && current.duration != null && (
        <View style={[styles.durPill, { top: insets.top + 64 }]} pointerEvents="none">
          <Ionicons name="videocam" size={13} color="#fff" />
          <Text style={styles.durText}>{formatDuration(current.duration)}</Text>
        </View>
      )}

      {/* bottom: strip + caption + send */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.bottomWrap}
        pointerEvents="box-none"
      >
        {slots.length > 1 && (
          <FlatList
            data={slots}
            horizontal
            keyExtractor={s => s.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            renderItem={({ item, index: i }) => (
              <Pressable onPress={() => goTo(i)} style={[styles.thumb, i === index && styles.thumbOn]}>
                {item.kind === 'file' ? (
                  <View style={[StyleSheet.absoluteFill, styles.thumbFile]}>
                    <Ionicons name="document-text" size={22} color="#fff" />
                  </View>
                ) : (
                  <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                )}
                {item.viewOnce && (
                  <View style={styles.thumbOnce}>
                    <Text style={styles.thumbOnceText}>1</Text>
                  </View>
                )}
              </Pressable>
            )}
          />
        )}
        <View style={[styles.captionRow, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.captionBox}>
            <TextInput
              value={current.caption}
              onChangeText={t => patch(index, { caption: t })}
              placeholder={slots.length > 1 ? `Add a caption to item ${index + 1}…` : 'Add a caption…'}
              placeholderTextColor="#9aa1b0"
              style={styles.captionInput}
              multiline
              maxLength={1000}
              selectionColor="#9d7bff"
            />
            {canViewOnce && (
              <Pressable
                onPress={() => patch(index, { viewOnce: !current.viewOnce })}
                hitSlop={8}
                style={[styles.once, current.viewOnce && styles.onceOn]}
                accessibilityRole="switch"
                accessibilityState={{ checked: current.viewOnce }}
                accessibilityLabel="View once"
              >
                <Text style={styles.onceText}>1</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => void send()}
            style={[styles.send, busy && { opacity: 0.6 }]}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Ionicons name="send" size={22} color="#fff" />
            {slots.length > 1 && (
              <View style={styles.sendCount}>
                <Text style={styles.sendCountText}>{slots.length}</Text>
              </View>
            )}
          </Pressable>
        </View>
        {current.viewOnce && (
          <Text style={styles.onceHint} pointerEvents="none">
            View once: disappears after the recipient opens it
          </Text>
        )}
      </KeyboardAvoidingView>

      {current.kind === 'image' && current.width && current.height ? (
        <CropModal
          visible={cropping}
          uri={current.uri}
          width={current.width}
          height={current.height}
          onCancel={() => setCropping(false)}
          onDone={rect => {
            setCropping(false)
            void applyEdit([{ crop: rect }])
          }}
        />
      ) : null}
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  topRight: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  roundBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  pill: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  pillOn: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  durPill: { position: 'absolute', left: 16, flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  durText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  strip: { paddingHorizontal: 12, gap: 8, paddingBottom: 10 },
  thumb: { width: 54, height: 54, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: '#1d212c' },
  thumbOn: { borderColor: '#fff' },
  thumbFile: { alignItems: 'center', justifyContent: 'center' },
  thumbOnce: { position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: '#5b5bd6', alignItems: 'center', justifyContent: 'center' },
  thumbOnceText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  captionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.35)', paddingTop: 10 },
  captionBox: { flex: 1, minHeight: 46, maxHeight: 130, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: 'rgba(30,33,44,0.92)', borderRadius: 24, paddingLeft: 16, paddingRight: 8 },
  captionInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 12, maxHeight: 120 },
  once: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#cfd4de', alignItems: 'center', justifyContent: 'center', marginBottom: 8, marginLeft: 6 },
  onceOn: { backgroundColor: '#5b5bd6', borderColor: '#5b5bd6' },
  onceText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  onceHint: { color: '#cfd4de', fontSize: 12, textAlign: 'center', paddingBottom: 4, backgroundColor: 'rgba(0,0,0,0.35)' },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#5b5bd6', alignItems: 'center', justifyContent: 'center' },
  sendCount: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  sendCountText: { color: '#5b5bd6', fontSize: 11, fontWeight: '800' },
  fileWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  fileIcon: { width: 120, height: 140, borderRadius: 14, backgroundColor: '#5b5bd6', alignItems: 'center', justifyContent: 'center' },
  fileExt: { color: '#fff', fontWeight: '800', marginTop: 4 },
  fileName: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  fileSize: { color: '#9aa1b0', fontSize: 14 },
})

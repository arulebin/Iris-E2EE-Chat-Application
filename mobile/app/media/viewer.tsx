import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { useEvent } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  discardViewOnce, downloadMedia, getCachedMedia, saveToGallery, shareLocalFile, MediaError, type LocalMedia,
} from '@/media/pipeline'
import { endViewerSession, getViewerSession, type ViewerItem } from '@/media/session'
import { screenSecurity } from '@/media/screenSecurity'
import { kindFromMime } from '@/media/helpers'
import { getViewOnceState, markViewOnceOpened } from '@/media/viewOnceStore'
import { ProgressRing } from '@/media/ui/ProgressRing'
import { ZoomableImage } from '@/media/ui/ZoomableImage'

type PageState =
  | { phase: 'loading'; progress: number }
  | { phase: 'ready'; local: LocalMedia }
  | { phase: 'blocked'; reason: 'opened' | 'expired' | 'mine' }
  | { phase: 'error'; message: string }

function VideoPage({ uri, active, once, onEnded }: { uri: string; active: boolean; once: boolean; onEnded: () => void }) {
  const player = useVideoPlayer(uri, p => {
    p.loop = !once
  })
  useEffect(() => {
    if (active) player.play()
    else player.pause()
  }, [active, player])
  const end = useEvent(player, 'playToEnd', undefined as never)
  useEffect(() => {
    if (once && end !== undefined) onEnded()
  }, [end, once, onEnded])
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={!once} />
}

function Page(props: {
  item: ViewerItem
  active: boolean
  near: boolean
  onZoomedChange: (z: boolean) => void
  onTap: () => void
  onClose: () => void
  onLocal: (l: LocalMedia | null) => void
}) {
  const { item, active } = props
  // A view-once blob is consumed by the first GET, so it may only load once it is actually on screen.
  const near = item.viewOnce ? active : props.near
  const [state, setState] = useState<PageState>(() => {
    if (item.viewOnce) {
      if (item.mine) return { phase: 'blocked', reason: 'mine' }
      const s = getViewOnceState(item.mediaId)
      if (s !== 'unopened') return { phase: 'blocked', reason: s }
    }
    return { phase: 'loading', progress: 0 }
  })
  const started = useRef(false)

  useEffect(() => {
    if (!near || started.current || state.phase !== 'loading') return
    started.current = true
    let alive = true
    ;(async () => {
      try {
        let local: LocalMedia | null = null
        const ref = { mediaId: item.mediaId, key: item.mediaKey, mime: item.mime, name: item.name }
        if (item.localUri && !item.viewOnce) {
          local = { uri: item.localUri, mime: item.mime, kind: kindFromMime(item.mime), size: 0 }
        } else {
          local = item.viewOnce ? null : getCachedMedia(ref)
          local ??= await downloadMedia(ref, {
            viewOnce: !!item.viewOnce,
            onProgress: p => alive && setState({ phase: 'loading', progress: p }),
          })
        }
        if (!alive) {
          if (item.viewOnce) discardViewOnce(item)
          return
        }
        if (item.viewOnce) {
          // The server has now consumed the blob: record it before anything can go wrong on screen.
          markViewOnceOpened(item.mediaId)
          item.onViewed?.()
        }
        setState({ phase: 'ready', local })
      } catch (e) {
        if (!alive) return
        if (e instanceof MediaError && e.code === 'gone') setState({ phase: 'blocked', reason: 'expired' })
        else setState({ phase: 'error', message: e instanceof Error ? e.message : 'Could not load this media' })
      }
    })()
    return () => {
      alive = false
    }
  }, [near, item, state.phase])

  // view-once: hold screen security while this page is the visible one, and wipe plaintext on leave
  useEffect(() => {
    if (!item.viewOnce || item.mine || !active) return
    const release = screenSecurity.acquire()
    return () => {
      release()
    }
  }, [item.viewOnce, item.mine, active])
  useEffect(
    () => () => {
      if (item.viewOnce && !item.mine) discardViewOnce(item)
    },
    [item],
  )

  const { onLocal } = props
  useEffect(() => {
    onLocal(state.phase === 'ready' ? state.local : null)
  }, [state, onLocal])

  if (state.phase === 'blocked') {
    const text =
      state.reason === 'mine'
        ? 'You sent this as view once. It can’t be reopened.'
        : state.reason === 'opened'
          ? 'Already opened. View-once media can only be seen one time.'
          : 'This media has expired.'
    return (
      <View style={styles.center}>
        <View style={styles.blockIcon}>
          <Text style={styles.blockOne}>1</Text>
        </View>
        <Text style={styles.blockText}>{text}</Text>
        <Pressable onPress={props.onClose} style={styles.blockBtn}>
          <Text style={styles.blockBtnText}>Close</Text>
        </Pressable>
      </View>
    )
  }
  if (state.phase === 'error') {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={44} color="#fff" />
        <Text style={styles.blockText}>{state.message}</Text>
        <Pressable
          onPress={() => {
            started.current = false
            setState({ phase: 'loading', progress: 0 })
          }}
          style={styles.blockBtn}
        >
          <Text style={styles.blockBtnText}>Try again</Text>
        </Pressable>
      </View>
    )
  }
  if (state.phase === 'loading') {
    return (
      <View style={styles.center}>
        {item.blurhash ? (
          <Image source={{ blurhash: item.blurhash }} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : null}
        <ProgressRing size={64} stroke={4} progress={state.progress > 0 ? state.progress : undefined}>
          <ActivityIndicator color="#fff" />
        </ProgressRing>
      </View>
    )
  }

  const { local } = state
  if (local.kind === 'video') {
    return (
      <VideoPage
        uri={local.uri}
        active={active}
        once={!!item.viewOnce}
        onEnded={props.onClose}
      />
    )
  }
  return (
    <ZoomableImage
      uri={local.uri}
      width={item.width}
      height={item.height}
      blurhash={item.blurhash}
      onZoomedChange={props.onZoomedChange}
      onSingleTap={props.onTap}
    />
  )
}

export default function ViewerScreen() {
  const { sid, i } = useLocalSearchParams<{ sid: string; i?: string }>()
  const session = getViewerSession(sid)
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const items = session?.items ?? []
  const [index, setIndex] = useState(Math.min(Math.max(0, Number(i ?? session?.index ?? 0) || 0), Math.max(0, items.length - 1)))
  const [zoomed, setZoomed] = useState(false)
  const [chrome, setChrome] = useState(true)
  const [local, setLocal] = useState<LocalMedia | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const closing = useRef(false)

  const dragY = useSharedValue(0)
  const closeP = useSharedValue(0)
  const origin = session?.origin

  const current = items[index]
  const isOnce = !!current?.viewOnce && !current.mine

  useEffect(() => () => endViewerSession(sid), [sid])
  useEffect(() => {
    if (!session) router.back()
  }, [session])

  const finish = useCallback(() => {
    if (router.canGoBack()) router.back()
  }, [])

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    closeP.set(
      withTiming(1, { duration: 230, easing: Easing.out(Easing.cubic) }, done => {
        if (done) runOnJS(finish)()
      }),
    )
  }, [closeP, finish])

  const pan = Gesture.Pan()
    .enabled(!zoomed)
    .maxPointers(1)
    .activeOffsetY([-14, 14])
    .failOffsetX([-14, 14])
    .onUpdate(e => {
      dragY.set(e.translationY)
    })
    .onEnd(e => {
      if (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 900) {
        runOnJS(close)()
      } else {
        dragY.set(withSpring(0, { damping: 18, stiffness: 220 }))
      }
    })

  const containerStyle = useAnimatedStyle(() => {
    const p = closeP.get()
    const dy = dragY.get()
    const drag = Math.min(1, Math.abs(dy) / (height * 0.5))
    // Shrink toward the originating thumbnail (shared-element feel); without an origin, just shrink + fall.
    const s0 = origin ? Math.max(0.12, origin.width / width) : 0.8
    const ox = origin ? origin.x + origin.width / 2 - width / 2 : 0
    const oy = origin ? origin.y + origin.height / 2 - height / 2 : height * 0.15
    const scale = (1 - drag * 0.35) * (1 - p * (1 - s0))
    return {
      opacity: 1 - p * 0.9,
      transform: [{ translateX: p * ox }, { translateY: dy + p * oy }, { scale }],
      borderRadius: p * 18,
      overflow: 'hidden',
    }
  })
  const backdropStyle = useAnimatedStyle(() => {
    const drag = Math.min(1, Math.abs(dragY.get()) / (height * 0.45))
    return { opacity: (1 - drag) * (1 - closeP.get()) }
  })

  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 1800)
  }

  const onSave = async () => {
    if (!local || !current || isOnce || current.viewOnce) return
    try {
      await saveToGallery(local)
      flash('Saved to gallery')
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save')
    }
  }
  const onShare = async () => {
    if (!local || !current || current.viewOnce) return
    try {
      await shareLocalFile(local)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not share')
    }
  }

  if (!session || !current) return <View style={styles.root} />

  const canExport = !current.viewOnce && local != null

  return (
    <GestureHandlerRootView style={styles.fill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, containerStyle]}>
          <FlatList
            data={items}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed && items.length > 1 && !isOnce}
            showsHorizontalScrollIndicator={false}
            keyExtractor={it => it.key}
            initialScrollIndex={index}
            getItemLayout={(_, k) => ({ length: width, offset: width * k, index: k })}
            onMomentumScrollEnd={e => {
              setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
              setZoomed(false)
            }}
            renderItem={({ item, index: k }) => (
              <View style={{ width, height }}>
                <Page
                  item={item}
                  active={k === index}
                  near={Math.abs(k - index) <= 1}
                  onZoomedChange={setZoomed}
                  onTap={() => setChrome(c => !c)}
                  onClose={close}
                  onLocal={k === index ? setLocal : noop}
                />
              </View>
            )}
          />
        </Animated.View>
      </GestureDetector>

      {chrome && (
        <>
          <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
            <Pressable onPress={close} hitSlop={12} style={styles.roundBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
            {items.length > 1 && (
              <Text style={styles.counter}>
                {index + 1} / {items.length}
              </Text>
            )}
            <View style={styles.topRight}>
              {isOnce ? (
                <View style={styles.oncePill}>
                  <Text style={styles.onceOne}>1</Text>
                  <Text style={styles.onceTxt}>View once</Text>
                </View>
              ) : (
                canExport && (
                  <>
                    {current.mime.startsWith('image/') || current.mime.startsWith('video/') ? (
                      <Pressable onPress={() => void onSave()} style={styles.roundBtn} accessibilityLabel="Save to gallery">
                        <Ionicons name="download-outline" size={22} color="#fff" />
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => void onShare()} style={styles.roundBtn} accessibilityLabel="Share">
                      <Ionicons name="share-outline" size={22} color="#fff" />
                    </Pressable>
                  </>
                )
              )}
            </View>
          </View>
          {!!current.caption && (
            <View style={[styles.caption, { paddingBottom: insets.bottom + 14 }]} pointerEvents="none">
              <Text style={styles.captionText}>{current.caption}</Text>
            </View>
          )}
        </>
      )}
      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 90 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </GestureHandlerRootView>
  )
}

const noop = () => {}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 36 },
  blockIcon: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#8b93a3', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  blockOne: { color: '#8b93a3', fontSize: 30, fontWeight: '800' },
  blockText: { color: '#e7eaf1', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  blockBtn: { backgroundColor: '#5b5bd6', paddingHorizontal: 26, paddingVertical: 12, borderRadius: 24 },
  blockBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  topRight: { flexDirection: 'row', gap: 10, minWidth: 44, justifyContent: 'flex-end' },
  roundBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  counter: { color: '#fff', fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, overflow: 'hidden' },
  oncePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, height: 34, borderRadius: 17 },
  onceOne: { color: '#fff', fontWeight: '800', borderWidth: 1.5, borderColor: '#fff', borderRadius: 9, width: 18, height: 18, textAlign: 'center', fontSize: 11, lineHeight: 15 },
  onceTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 18, paddingTop: 12 },
  captionText: { color: '#fff', fontSize: 16, lineHeight: 22 },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(30,33,44,0.95)', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16 },
  toastText: { color: '#fff', fontSize: 14 },
})

import { useEffect } from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  FadeIn, FadeOut, interpolate, useAnimatedStyle, useSharedValue, ZoomIn, type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CallEngine, CallSnapshot } from '../engine'
import { formatDuration } from '../signals'
import { dismissZone, type Size } from '../snap'
import { Draggable } from './Draggable'
import { CloseIcon, MicIcon, PhoneIcon } from './icons'
import { Avatar, GREEN, RED, VideoView, hasVideo, useElapsed } from './parts'

const MINI_VIDEO: Size = { w: 116, h: 172 }
const MINI_VOICE: Size = { w: 104, h: 128 }

type Props = { snap: CallSnapshot; engine: CallEngine; name: string; avatarUrl?: string }

/**
 * The call, shrunk to a floating window over the whole app. Drag it anywhere (it
 * sticks to the side edges); drop it on the target at the bottom centre and it
 * collapses into the "On call" pill. Tap to expand.
 */
export function MiniWindow({ snap, engine, name, avatarUrl }: Props) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const viewport: Size = { w: width, h: height }
  const { state } = snap
  const elapsed = useElapsed(state.kind === 'active' ? state.startedAt : null)
  const remoteLive = hasVideo(snap.remoteStream) && !snap.remote.cameraOff && snap.state.kind === 'active'
  const size = remoteLive ? MINI_VIDEO : MINI_VOICE
  const dragging = useSharedValue(0)
  const over = useSharedValue(0)

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 95 }]}>
      <DismissTarget dragging={dragging} over={over} viewport={viewport} insetsBottom={insets.bottom} />
      <Draggable
        size={size}
        viewport={viewport}
        insets={{ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }}
        mode="edge"
        initial={{ x: width - size.w - 12, y: insets.top + 80 }}
        dragging={dragging}
        over={over}
        dismissable
        onDismiss={() => engine.setPreviewHidden(true)}
        onTap={() => engine.setMinimized(false)}
      >
        {remoteLive
          ? <VideoView stream={snap.remoteStream} style={StyleSheet.absoluteFill} zOrder={2} />
          : (
            <View style={styles.voice}>
              <Avatar name={name} uri={avatarUrl} size={52} />
              <Text style={styles.voiceName} numberOfLines={1}>{name}</Text>
            </View>
          )}
        <View style={styles.footer} pointerEvents="none">
          {snap.muted && <MicIcon off size={12} />}
          <Text style={styles.time}>{state.kind === 'outgoing' ? 'Calling…' : snap.reconnecting ? 'Reconnecting…' : formatDuration(elapsed)}</Text>
        </View>
      </Draggable>
    </View>
  )
}

function DismissTarget({ dragging, over, viewport, insetsBottom }: {
  dragging: SharedValue<number>; over: SharedValue<number>; viewport: Size; insetsBottom: number
}) {
  const zone = dismissZone(viewport, { top: 0, right: 0, bottom: insetsBottom, left: 0 })
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(dragging.value, [0, 1], [0, 1]),
    transform: [
      { translateY: interpolate(dragging.value, [0, 1], [40, 0]) },
      { scale: interpolate(over.value, [0, 1], [1, 1.35]) },
    ],
    backgroundColor: over.value > 0.5 ? RED : 'rgba(30,32,40,0.85)',
  }))
  return (
    <Animated.View pointerEvents="none" style={[styles.target, { left: zone.cx - 32, top: zone.cy - 32 }, style]}>
      <CloseIcon size={26} />
    </Animated.View>
  )
}

/** "On call · 1:23" — what remains after the window is dragged to the target. Tap to bring the call back. */
export function CallPill({ snap, engine, name }: { snap: CallSnapshot; engine: CallEngine; name: string }) {
  const insets = useSafeAreaInsets()
  const { state } = snap
  const elapsed = useElapsed(state.kind === 'active' ? state.startedAt : null)
  useEffect(() => {}, [])
  return (
    <Animated.View entering={ZoomIn.duration(180)} exiting={FadeOut.duration(140)} pointerEvents="box-none" style={[styles.pillWrap, { top: insets.top + 6 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Return to call with ${name}`}
        onPress={() => engine.setMinimized(false)}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.dot} />
        <Text style={styles.pillText}>{state.kind === 'outgoing' ? 'Calling' : 'On call'} · {state.kind === 'active' ? formatDuration(elapsed) : name}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="End call" hitSlop={8} onPress={() => engine.hangUp()} style={styles.pillEnd}>
          <PhoneIcon hangup size={14} />
        </Pressable>
      </Pressable>
    </Animated.View>
  )
}

/** Shown instead of the full UI while Android's system picture-in-picture window is up. */
export function PipView({ snap, name, avatarUrl }: { snap: CallSnapshot; name: string; avatarUrl?: string }) {
  const remoteLive = hasVideo(snap.remoteStream) && !snap.remote.cameraOff
  return (
    <Animated.View entering={FadeIn.duration(120)} style={[StyleSheet.absoluteFill, { backgroundColor: '#0b0d12', zIndex: 120 }]}>
      {remoteLive
        ? <VideoView stream={snap.remoteStream} style={StyleSheet.absoluteFill} />
        : <View style={styles.pipAvatar}><Avatar name={name} uri={avatarUrl} size={72} /></View>}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  voice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1b1f2a', paddingBottom: 18 },
  voiceName: { color: '#fff', fontSize: 13, maxWidth: 90 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  time: { color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] },
  target: { position: 'absolute', width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 95 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, paddingVertical: 6,
    borderRadius: 999, backgroundColor: GREEN, elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  pillText: { color: '#fff', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pillEnd: { width: 28, height: 28, borderRadius: 14, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  pipAvatar: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})

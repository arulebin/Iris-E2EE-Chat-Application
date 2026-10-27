import { useEffect, useState } from 'react'
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { controlsAutoHideWanted, createControlsAutoHide } from '../controls'
import type { CallEngine, CallSnapshot } from '../engine'
import { formatDuration } from '../signals'
import { CamIcon, ChevronDownIcon, FlipIcon, LockIcon, MicIcon, PhoneIcon, SpeakerIcon } from './icons'
import { Draggable } from './Draggable'
import { Avatar, CALL_BG, Chip, QualityBars, RoundButton, VideoView, hasVideo, useElapsed } from './parts'
import type { Point, Size } from '../snap'

const SELF: Size = { w: 104, h: 156 }
const textShadow = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 }

type Props = {
  snap: CallSnapshot
  engine: CallEngine
  name: string
  avatarUrl?: string
  onHangUp: () => void
  onToggleCamera: () => void
  /** Minimise button: picture-in-picture for a video call, the in-app window otherwise (CallOverlay decides). */
  onMinimise: () => void
}

/** Full-screen outgoing ringing + active call (voice and video). */
export function CallScreen({ snap, engine, name, avatarUrl, onHangUp, onToggleCamera, onMinimise }: Props) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const viewport: Size = { w: width, h: height }
  const { state } = snap
  const active = state.kind === 'active'
  const video = (state.kind === 'active' || state.kind === 'outgoing') && state.mode === 'video'
  const elapsed = useElapsed(state.kind === 'active' ? state.startedAt : null)

  // Which stream fills the screen. Tap the self-view to swap.
  const [swapped, setSwapped] = useState(false)
  const localLive = hasVideo(snap.localStream) && !snap.cameraOff
  const remoteLive = hasVideo(snap.remoteStream) && !snap.remote.cameraOff
  const showSelfTile = video && localLive
  const bigIsLocal = swapped && showSelfTile
  const bigHasVideo = bigIsLocal ? localLive : remoteLive

  // Video call: controls hide after a few seconds without interaction; a tap on the video toggles them
  // (src/calls/controls.ts). Voice calls and ringing keep them up.
  const [controlsOn, setControlsOn] = useState(true)
  const [controls] = useState(() => createControlsAutoHide(setControlsOn))
  useEffect(() => () => controls.dispose(), [controls])
  useEffect(() => controls.setEnabled(controlsAutoHideWanted(snap, bigHasVideo)), [controls, snap, bigHasVideo])
  const wake = controls.interact
  const ctl = useSharedValue(1)
  useEffect(() => { ctl.value = withTiming(controlsOn ? 1 : 0, { duration: 220 }) }, [controlsOn, ctl])
  const topStyle = useAnimatedStyle(() => ({ opacity: ctl.value, transform: [{ translateY: (1 - ctl.value) * -16 }] }))
  const bottomStyle = useAnimatedStyle(() => ({ opacity: ctl.value, transform: [{ translateY: (1 - ctl.value) * 24 }] }))

  // Back button minimises instead of closing the app on top of a live call.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { engine.setMinimized(true); return true })
    return () => sub.remove()
  }, [engine])

  const status = state.kind === 'outgoing'
    ? 'Calling…'
    : snap.reconnecting ? 'Reconnecting…' : formatDuration(elapsed)

  const selfInitial: Point = { x: width - SELF.w - 12, y: insets.top + 64 }
  const insetsBox = { top: insets.top + 56, right: insets.right, bottom: insets.bottom + 120, left: insets.left }

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={[StyleSheet.absoluteFill, styles.root]}>
      {/* Full-screen media, edge to edge with nothing laid over it; a tap toggles the controls */}
      <Pressable style={StyleSheet.absoluteFill} onPress={controls.tap} accessibilityLabel={controlsOn ? 'Hide call controls' : 'Show call controls'}>
        {bigHasVideo
          ? <VideoView stream={bigIsLocal ? snap.localStream : snap.remoteStream} mirror={bigIsLocal && snap.facing === 'user'} style={StyleSheet.absoluteFill} />
          : (
            <View style={styles.backdrop}>
              <Avatar name={name} uri={avatarUrl} size={140} />
              {video && !remoteLive && active && <Text style={styles.cameraOff}>{name}'s camera is off</Text>}
            </View>
          )}
      </Pressable>

      {/* Top bar */}
      <Animated.View pointerEvents={controlsOn ? 'box-none' : 'none'} style={[styles.top, { paddingTop: insets.top + 8 }, topStyle]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Minimise call" onPress={onMinimise} hitSlop={12} style={styles.minimise}>
          <ChevronDownIcon size={26} />
        </Pressable>
        <View style={styles.title} pointerEvents="none">
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.statusRow}>
            <LockIcon size={11} color="rgba(255,255,255,0.7)" />
            <Text style={styles.status}>{status}</Text>
            {active && <QualityBars quality={snap.quality} />}
          </View>
        </View>
        <View style={{ width: 44 }} />
      </Animated.View>

      {/* Banners */}
      <View pointerEvents="none" style={[styles.banners, { top: insets.top + 74 }]}>
        {snap.reconnecting && active && <Chip><Text style={styles.chipText}>Reconnecting…</Text></Chip>}
        {active && snap.remote.muted && <Chip><MicIcon off size={14} /><Text style={styles.chipText}>{name} is muted</Text></Chip>}
      </View>

      {/* Draggable self-view */}
      {showSelfTile && (
        <Draggable
          size={SELF}
          viewport={viewport}
          insets={insetsBox}
          mode="corner"
          initial={selfInitial}
          onTap={() => setSwapped((s) => !s)}
        >
          <VideoView
            stream={swapped ? snap.remoteStream : snap.localStream}
            mirror={!swapped && snap.facing === 'user'}
            style={StyleSheet.absoluteFill}
            zOrder={1}
          />
        </Draggable>
      )}

      {/* Controls */}
      <Animated.View pointerEvents={controlsOn ? 'box-none' : 'none'} style={[styles.bottom, { paddingBottom: insets.bottom + 24 }, bottomStyle]}>
        <View style={styles.bar}>
          <RoundButton raised label={snap.speakerOn ? 'Speaker on' : 'Speaker off'} active={snap.speakerOn} onPress={() => { wake(); engine.toggleSpeaker() }}>
            <SpeakerIcon on={snap.speakerOn} color={snap.speakerOn ? '#111' : '#fff'} />
          </RoundButton>
          <RoundButton raised label={snap.cameraOff || !video ? 'Turn camera on' : 'Turn camera off'} active={video && !snap.cameraOff} onPress={() => { wake(); onToggleCamera() }}>
            <CamIcon off={!video || snap.cameraOff} color={video && !snap.cameraOff ? '#111' : '#fff'} />
          </RoundButton>
          {video && localLive && (
            <RoundButton raised label="Flip camera" onPress={() => { wake(); engine.flipCamera() }}>
              <FlipIcon />
            </RoundButton>
          )}
          <RoundButton raised label={snap.muted ? 'Unmute' : 'Mute'} active={snap.muted} onPress={() => { wake(); engine.toggleMute() }}>
            <MicIcon off={snap.muted} color={snap.muted ? '#111' : '#fff'} />
          </RoundButton>
          <RoundButton raised label="End call" danger onPress={onHangUp}>
            <PhoneIcon hangup size={26} />
          </RoundButton>
        </View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: CALL_BG, zIndex: 90 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, backgroundColor: '#12151d' },
  cameraOff: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  // No scrims or bars over the video: the text carries its own shadow and the buttons their own (RoundButton raised).
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  minimise: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22,
    backgroundColor: 'rgba(18,20,28,0.4)', boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.3)',
  },
  title: { flex: 1, alignItems: 'center', gap: 2 },
  name: { color: '#fff', fontSize: 19, fontWeight: '600', maxWidth: '80%', ...textShadow },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'], ...textShadow },
  banners: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 8 },
  chipText: { color: '#fff', fontSize: 13 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
})

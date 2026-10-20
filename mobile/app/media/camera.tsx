import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { router, useIsFocused, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  usePhotoOutput,
  useVideoOutput,
  type CameraRef,
  type Recorder,
} from 'react-native-vision-camera'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { openPreviewWith, useCloseMediaFlow } from '@/media/api'
import { clampZoom, dragToZoom, formatDuration } from '@/media/helpers'
import { randomId } from '@/media/files'
import { MAX_VIDEO_SECONDS } from '@/media/limits'
import type { MediaSource } from '@/media/types'
import { PermissionGate } from '@/media/ui/PermissionGate'
import { ProgressRing } from '@/media/ui/ProgressRing'

type FlashMode = 'off' | 'auto' | 'on'
const FLASH_ICON: Record<FlashMode, keyof typeof Ionicons.glyphMap> = {
  off: 'flash-off',
  auto: 'flash-outline',
  on: 'flash',
}
const NEXT_FLASH: Record<FlashMode, FlashMode> = { off: 'auto', auto: 'on', on: 'off' }
const HOLD_MS = 280
const MAX_ZOOM_UI = 10
/** ~5 Mbps keeps a full 60 s 1080p clip around 38 MB, safely under the 50 MB upload cap. */
const VIDEO_BITRATE = 5_000_000
const MAX_RECORD_BYTES = 47 * 1024 * 1024

const toUri = (p: string) => (p.startsWith('file://') || p.startsWith('content://') ? p : `file://${p}`)

export default function CameraScreen() {
  const params = useLocalSearchParams<{ conversationId: string; allowViewOnce?: string; viewOnce?: string }>()
  const close = useCloseMediaFlow()
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()
  const focused = useIsFocused()

  const cam = useCameraPermission()
  const mic = useMicrophonePermission()
  const [askedMic, setAskedMic] = useState(false)

  const [position, setPosition] = useState<'back' | 'front'>('back')
  const [flash, setFlash] = useState<FlashMode>('off')
  const [grid, setGrid] = useState(false)
  const [timer, setTimer] = useState<0 | 3 | 10>(0)
  const [mirrorSelfie, setMirrorSelfie] = useState(true)
  const [countdown, setCountdown] = useState(0)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [zoomLabel, setZoomLabel] = useState(1)
  const [screenFlash, setScreenFlash] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const device = useCameraDevice(position)
  const cameraRef = useRef<CameraRef>(null)

  const photoOutput = usePhotoOutput({
    // 16:9 so the saved photo frames exactly what the full-screen preview shows.
    targetResolution: CommonResolutions.UHD_16_9,
    containerFormat: 'jpeg',
    quality: 0.95,
    qualityPrioritization: 'quality',
  })
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    targetBitRate: VIDEO_BITRATE,
    enableAudio: mic.hasPermission,
    fileType: 'mp4',
  })

  // ---- zoom / exposure / focus ring (UI-thread shared values) ----
  const zoom = useSharedValue(1)
  const zoomMin = useSharedValue(1)
  const zoomMax = useSharedValue(MAX_ZOOM_UI)
  const pinchBase = useSharedValue(1)
  const exposure = useSharedValue(0)
  const expBase = useSharedValue(0)
  const expRange = useSharedValue(2)
  const ringX = useSharedValue(0)
  const ringY = useSharedValue(0)
  const ringOpacity = useSharedValue(0)
  const ringScale = useSharedValue(1.4)
  const shutterScale = useSharedValue(1)

  useEffect(() => {
    if (!device) return
    const min = Math.max(1, device.minZoom)
    zoomMin.set(min)
    zoomMax.set(Math.min(device.maxZoom, MAX_ZOOM_UI))
    zoom.set(min)
    exposure.set(0)
    expRange.set(Math.max(0.5, Math.min(Math.abs(device.minExposureBias), device.maxExposureBias, 3)))
  }, [device, zoom, zoomMin, zoomMax, exposure, expRange])

  useAnimatedReaction(
    () => Math.round(zoom.get() * 10) / 10,
    (v, prev) => {
      if (v !== prev) scheduleOnRN(setZoomLabel, v)
    },
  )

  const showFocusRing = useCallback(
    (x: number, y: number) => {
      ringX.set(x)
      ringY.set(y)
      ringScale.set(1.4)
      ringScale.set(withTiming(1, { duration: 180 }))
      ringOpacity.set(withSequence(withTiming(1, { duration: 80 }), withDelay(1400, withTiming(0, { duration: 300 }))))
    },
    [ringX, ringY, ringScale, ringOpacity],
  )

  const focusAt = useCallback(
    async (x: number, y: number) => {
      showFocusRing(x, y)
      void Haptics.selectionAsync()
      try {
        await cameraRef.current?.focusTo({ x, y }, { autoResetAfter: 4 })
      } catch {
        // device without focus metering (e.g. some front cameras): the ring still gives feedback
      }
    },
    [showFocusRing],
  )

  const flip = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPosition(p => (p === 'back' ? 'front' : 'back'))
  }, [])

  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinchBase.set(zoom.get())
    })
    .onUpdate(e => {
      zoom.set(clampZoom(pinchBase.get() * e.scale, zoomMin.get(), zoomMax.get()))
    })

  const singleTap = Gesture.Tap().onEnd((e, ok) => {
    if (ok) scheduleOnRN(focusAt, e.x, e.y)
  })
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, ok) => {
      if (ok) scheduleOnRN(flip)
    })
  // Vertical drag while the focus ring is up adjusts exposure (Snapchat/iOS style).
  const exposurePan = Gesture.Pan()
    .minDistance(8)
    .onStart(() => {
      expBase.set(exposure.get())
    })
    .onUpdate(e => {
      if (ringOpacity.get() < 0.5) return
      ringOpacity.set(1)
      const next = expBase.get() - (e.translationY / 160) * expRange.get()
      exposure.set(Math.max(-expRange.get(), Math.min(expRange.get(), next)))
    })
  const previewGesture = Gesture.Simultaneous(pinch, exposurePan, Gesture.Exclusive(doubleTap, singleTap))

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.get(),
    transform: [{ translateX: ringX.get() - 36 }, { translateY: ringY.get() - 36 }, { scale: ringScale.get() }],
  }))
  const sunStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(exposure.get() / Math.max(0.1, expRange.get())) * 28 }],
  }))
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.get() }] }))

  // ---- capture ----
  const finish = useCallback(
    (item: MediaSource) => {
      openPreviewWith(
        String(params.conversationId ?? ''),
        [item],
        'camera',
        { allowViewOnce: params.allowViewOnce !== '0', viewOnce: params.viewOnce === '1' },
      )
    },
    [params.conversationId, params.allowViewOnce, params.viewOnce],
  )

  const takePhoto = useCallback(async () => {
    try {
      const front = position === 'front'
      const useScreenFlash = front && flash !== 'off'
      if (useScreenFlash) {
        setScreenFlash(true)
        await new Promise(r => setTimeout(r, 220))
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      const photo = await photoOutput.capturePhoto(
        { flashMode: front ? 'off' : flash, enableShutterSound: true },
        {},
      )
      const path = await photo.saveToTemporaryFileAsync()
      setScreenFlash(false)
      finish({ id: randomId(4), kind: 'image', uri: toUri(path), mime: 'image/jpeg' })
    } catch (e) {
      setScreenFlash(false)
      setError(e instanceof Error ? e.message : 'Could not take the photo')
    }
  }, [flash, position, photoOutput, finish])

  const recorderRef = useRef<Recorder | null>(null)
  const holdingRef = useRef(false)
  const recordingRef = useRef(false)
  const startedAtRef = useRef(0)

  const onRecordingDone = useCallback(
    (path: string) => {
      recordingRef.current = false
      setRecording(false)
      shutterScale.set(withTiming(1, { duration: 150 }))
      const seconds = Math.min(MAX_VIDEO_SECONDS, (Date.now() - startedAtRef.current) / 1000)
      finish({ id: randomId(4), kind: 'video', uri: toUri(path), mime: 'video/mp4', duration: seconds })
    },
    [finish, shutterScale],
  )

  const startRecording = useCallback(async () => {
    if (recordingRef.current) return
    recordingRef.current = true
    setRecording(true)
    setElapsed(0)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    shutterScale.set(withTiming(1.25, { duration: 180 }))
    try {
      const recorder = await videoOutput.createRecorder({ maxDuration: MAX_VIDEO_SECONDS, maxFileSize: MAX_RECORD_BYTES })
      recorderRef.current = recorder
      if (!holdingRef.current) {
        // Finger lifted while the recorder was being prepared: treat as a cancelled hold.
        recordingRef.current = false
        setRecording(false)
        shutterScale.set(withTiming(1, { duration: 150 }))
        await recorder.cancelRecording().catch(() => {})
        recorderRef.current = null
        return
      }
      startedAtRef.current = Date.now()
      await recorder.startRecording(
        path => onRecordingDone(path),
        err => {
          recordingRef.current = false
          setRecording(false)
          shutterScale.set(withTiming(1, { duration: 150 }))
          setError(err.message)
        },
      )
    } catch (e) {
      recordingRef.current = false
      setRecording(false)
      shutterScale.set(withTiming(1, { duration: 150 }))
      setError(e instanceof Error ? e.message : 'Could not start recording')
    }
  }, [videoOutput, onRecordingDone, shutterScale])

  const stopRecording = useCallback(async () => {
    const r = recorderRef.current
    if (!r || !recordingRef.current) return
    try {
      await r.stopRecording()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop recording')
    }
  }, [])

  // Elapsed ticker for the progress ring.
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setElapsed(Math.min(MAX_VIDEO_SECONDS, (Date.now() - startedAtRef.current) / 1000)), 100)
    return () => clearInterval(id)
  }, [recording])

  // Shutter: tap = photo, hold = video, drag up while holding = zoom. Raw touches keep one finger owning the
  // whole interaction (no gesture-handler arbitration with the preview recognisers).
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartY = useRef(0)
  const zoomAtStart = useRef(1)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runTimerThenShoot = useCallback(() => {
    let n = timer
    setCountdown(n)
    countdownRef.current = setInterval(() => {
      n -= 1
      setCountdown(n)
      if (n <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current)
        countdownRef.current = null
        void takePhoto()
      }
    }, 1000)
  }, [timer, takePhoto])

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = null
    setCountdown(0)
  }, [])

  const onShutterStart = (y: number) => {
    if (countdownRef.current) {
      cancelCountdown()
      return
    }
    holdingRef.current = true
    touchStartY.current = y
    zoomAtStart.current = zoom.get()
    shutterScale.set(withTiming(0.9, { duration: 90 }))
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      void startRecording()
    }, HOLD_MS)
  }
  const onShutterMove = (y: number) => {
    if (!recordingRef.current) return
    zoom.set(dragToZoom(zoomAtStart.current, touchStartY.current - y, screenH, zoomMin.get(), zoomMax.get()))
  }
  const onShutterEnd = () => {
    holdingRef.current = false
    if (holdTimer.current) {
      // Released before the hold threshold: a tap.
      clearTimeout(holdTimer.current)
      holdTimer.current = null
      shutterScale.set(withTiming(1, { duration: 120 }))
      if (timer > 0) runTimerThenShoot()
      else void takePhoto()
      return
    }
    if (recordingRef.current) void stopRecording()
  }

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
      const r = recorderRef.current
      if (r && recordingRef.current) void r.cancelRecording().catch(() => {})
    },
    [],
  )

  // ---- permissions ----
  const ensureMic = useCallback(async () => {
    if (!mic.hasPermission && mic.canRequestPermission && !askedMic) {
      setAskedMic(true)
      await mic.requestPermission()
    }
  }, [mic, askedMic])

  const requestAll = useCallback(async () => {
    const ok = cam.hasPermission || (await cam.requestPermission())
    if (ok) await ensureMic()
  }, [cam, ensureMic])

  useEffect(() => {
    if (cam.hasPermission) void ensureMic()
  }, [cam.hasPermission, ensureMic])

  if (!cam.hasPermission) {
    return (
      <PermissionGate
        icon="camera"
        title="Allow camera access"
        body="Iris uses your camera to take photos and record videos to send in chats. Nothing is uploaded until you tap send, and everything is end-to-end encrypted."
        blocked={cam.status === 'denied' || cam.status === 'restricted'}
        onAllow={() => void requestAll()}
        onClose={close}
        allowLabel="Allow camera"
      />
    )
  }

  const hasFlash = position === 'back' ? !!device?.hasFlash : true
  const showMicNote = !mic.hasPermission && mic.status !== 'not-determined'
  const torchOn = recording && flash === 'on' && position === 'back' && !!device?.hasTorch

  return (
    <GestureHandlerRootView style={styles.root}>
      {device && focused ? (
        <GestureDetector gesture={previewGesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Camera
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              isActive={focused}
              device={device}
              outputs={[photoOutput, videoOutput]}
              zoom={zoom}
              exposure={exposure}
              torchMode={torchOn ? 'on' : 'off'}
              mirrorMode={position === 'front' ? (mirrorSelfie ? 'on' : 'off') : 'off'}
              resizeMode="cover"
              onStarted={() => setReady(true)}
              onError={e => setError(e.message)}
            />
            {grid && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={[styles.gridV, { left: '33.33%' }]} />
                <View style={[styles.gridV, { left: '66.66%' }]} />
                <View style={[styles.gridH, { top: '33.33%' }]} />
                <View style={[styles.gridH, { top: '66.66%' }]} />
              </View>
            )}
            <Animated.View style={[styles.focusRing, ringStyle]} pointerEvents="none">
              <View style={styles.focusBox} />
              <Animated.View style={[styles.sun, sunStyle]}>
                <Ionicons name="sunny" size={16} color="#ffd54a" />
              </Animated.View>
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}

      {!ready && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none" />}
      {screenFlash && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }]} pointerEvents="none" />}

      {/* top bar */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={close} hitSlop={12} style={styles.roundBtn} accessibilityLabel="Close camera">
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        {recording ? (
          <View style={styles.recPill}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>{formatDuration(elapsed)}</Text>
          </View>
        ) : null}
        <View style={{ width: 44 }} />
      </View>

      {/* right rail */}
      {!recording && (
        <View style={[styles.rail, { top: insets.top + 64 }]} pointerEvents="box-none">
          {hasFlash && (
            <Pressable onPress={() => setFlash(f => NEXT_FLASH[f])} style={styles.railBtn} accessibilityLabel={`Flash ${flash}`}>
              <Ionicons name={FLASH_ICON[flash]} size={24} color="#fff" />
              {flash === 'auto' && <Text style={styles.railTag}>A</Text>}
            </Pressable>
          )}
          <Pressable onPress={flip} style={styles.railBtn} accessibilityLabel="Flip camera">
            <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => setTimer(t => (t === 0 ? 3 : t === 3 ? 10 : 0))}
            style={styles.railBtn}
            accessibilityLabel={`Timer ${timer === 0 ? 'off' : `${timer} seconds`}`}
          >
            <Ionicons name="timer-outline" size={26} color={timer ? '#ffd54a' : '#fff'} />
            {timer > 0 && <Text style={[styles.railTag, { color: '#ffd54a' }]}>{timer}s</Text>}
          </Pressable>
          <Pressable onPress={() => setGrid(g => !g)} style={styles.railBtn} accessibilityLabel="Toggle grid">
            <Ionicons name="grid-outline" size={22} color={grid ? '#ffd54a' : '#fff'} />
          </Pressable>
          {position === 'front' && (
            <Pressable onPress={() => setMirrorSelfie(m => !m)} style={styles.railBtn} accessibilityLabel="Mirror selfies">
              <Ionicons name="swap-horizontal" size={24} color={mirrorSelfie ? '#ffd54a' : '#fff'} />
            </Pressable>
          )}
        </View>
      )}

      {countdown > 0 && (
        <View style={styles.countdown} pointerEvents="none">
          <Text style={styles.countdownText}>{countdown}</Text>
        </View>
      )}

      {zoomLabel > 1.05 && (
        <View style={[styles.zoomPill, { bottom: insets.bottom + 168 }]} pointerEvents="none">
          <Text style={styles.zoomText}>{zoomLabel.toFixed(1)}x</Text>
        </View>
      )}

      {showMicNote && (
        <Pressable onPress={() => void Linking.openSettings()} style={[styles.micNote, { bottom: insets.bottom + 128 }]}>
          <Ionicons name="mic-off" size={14} color="#fff" />
          <Text style={styles.micNoteText}>Videos will be silent. Allow microphone</Text>
        </Pressable>
      )}

      {error && (
        <Pressable onPress={() => setError(null)} style={[styles.errorBar, { bottom: insets.bottom + 200 }]}>
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      )}

      {/* bottom controls */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 22 }]} pointerEvents="box-none">
        {!recording ? (
          <Pressable
            onPress={() => router.push({ pathname: '/media/picker', params: { ...params } } as never)}
            style={styles.sideBtn}
            accessibilityLabel="Open gallery"
          >
            <Ionicons name="images" size={26} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.sideBtn} />
        )}

        <Animated.View
          style={shutterStyle}
          onTouchStart={e => onShutterStart(e.nativeEvent.pageY)}
          onTouchMove={e => onShutterMove(e.nativeEvent.pageY)}
          onTouchEnd={onShutterEnd}
          onTouchCancel={onShutterEnd}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Shutter. Tap for photo, hold for video"
        >
          <ProgressRing
            size={96}
            stroke={6}
            progress={recording ? elapsed / MAX_VIDEO_SECONDS : 0}
            color="#ff3b30"
            track={recording ? 'rgba(255,255,255,0.3)' : '#fff'}
          >
            <View style={[styles.shutterInner, recording && styles.shutterInnerRec]} />
          </ProgressRing>
        </Animated.View>

        {!recording ? (
          <Pressable onPress={flip} style={styles.sideBtn} accessibilityLabel="Flip camera">
            <Ionicons name="sync" size={26} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.sideBtn} />
        )}
      </View>
      {!recording && (
        <Text style={[styles.hint, { bottom: insets.bottom + 4 }]} pointerEvents="none">
          Tap for photo, hold for video
        </Text>
      )}
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  recPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff3b30' },
  recText: { color: '#fff', fontWeight: '700', fontVariant: ['tabular-nums'] },
  rail: { position: 'absolute', right: 14, gap: 10 },
  railBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  railTag: { position: 'absolute', bottom: 3, right: 4, color: '#fff', fontSize: 9, fontWeight: '800' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 24 },
  sideBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  shutterInner: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#fff' },
  shutterInnerRec: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#ff3b30' },
  hint: { position: 'absolute', alignSelf: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  countdown: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  countdownText: { color: '#fff', fontSize: 120, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 12 },
  zoomPill: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  zoomText: { color: '#ffd54a', fontWeight: '700' },
  micNote: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  micNoteText: { color: '#fff', fontSize: 12 },
  errorBar: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(220,38,38,0.9)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, maxWidth: '86%' },
  errorText: { color: '#fff', fontSize: 13, textAlign: 'center' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.45)' },
  focusRing: { position: 'absolute', left: 0, top: 0, width: 72, height: 72 },
  focusBox: { width: 72, height: 72, borderWidth: 1.5, borderColor: '#ffd54a', borderRadius: 6 },
  sun: { position: 'absolute', right: -26, top: 28 },
})

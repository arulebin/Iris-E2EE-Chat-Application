import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cropWindow, type Aspect } from '../cropMath'

interface Props {
  visible: boolean
  uri: string
  /** Pixel size of the source image. */
  width: number
  height: number
  onCancel: () => void
  /** Crop rect in source pixels. */
  onDone: (rect: { originX: number; originY: number; width: number; height: number }) => void
}

const ASPECTS: { key: string; label: string; ratio: Aspect }[] = [
  { key: 'free', label: 'Free', ratio: null },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
]

/** Aspect-preset crop: pick a ratio, drag the window over the photo. */
export function CropModal({ visible, uri, width: srcW, height: srcH, onCancel, onDone }: Props) {
  const insets = useSafeAreaInsets()
  const { width: sw, height: sh } = useWindowDimensions()
  const [aspectKey, setAspectKey] = useState('free')

  const stageW = sw
  const stageH = sh - insets.top - insets.bottom - 150
  // contain-fit of the image inside the stage
  const fit = Math.min(stageW / srcW, stageH / srcH)
  const imgW = srcW * fit
  const imgH = srcH * fit

  const ratio = ASPECTS.find(a => a.key === aspectKey)?.ratio ?? null
  const win = useMemo(() => cropWindow(imgW, imgH, ratio), [imgW, imgH, ratio])

  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const sx = useSharedValue(0)
  const sy = useSharedValue(0)
  const maxX = useSharedValue(0)
  const maxY = useSharedValue(0)

  useEffect(() => {
    maxX.set(imgW - win.width)
    maxY.set(imgH - win.height)
    tx.set((imgW - win.width) / 2)
    ty.set((imgH - win.height) / 2)
  }, [win, imgW, imgH, maxX, maxY, tx, ty])

  const pan = Gesture.Pan()
    .onStart(() => {
      sx.set(tx.get())
      sy.set(ty.get())
    })
    .onUpdate(e => {
      tx.set(Math.min(maxX.get(), Math.max(0, sx.get() + e.translationX)))
      ty.set(Math.min(maxY.get(), Math.max(0, sy.get() + e.translationY)))
    })

  const winStyle = useAnimatedStyle(() => ({
    width: win.width,
    height: win.height,
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }],
  }))

  const confirm = () => {
    const k = 1 / fit
    onDone({
      originX: Math.round(tx.get() * k),
      originY: Math.round(ty.get() * k),
      width: Math.min(srcW, Math.round(win.width * k)),
      height: Math.min(srcH, Math.round(win.height * k)),
    })
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Pressable onPress={onCancel} hitSlop={10}>
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Crop</Text>
          <Pressable onPress={confirm} hitSlop={10}>
            <Text style={[styles.link, { color: '#9d7bff', fontWeight: '800' }]}>Done</Text>
          </Pressable>
        </View>
        <View style={{ width: stageW, height: stageH, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: imgW, height: imgH }}>
            <Image source={{ uri }} style={{ width: imgW, height: imgH }} contentFit="fill" />
            <GestureDetector gesture={pan}>
              <Animated.View style={[styles.window, winStyle]}>
                <View style={[styles.gl, { left: '33.3%', top: 0, bottom: 0, width: 1 }]} />
                <View style={[styles.gl, { left: '66.6%', top: 0, bottom: 0, width: 1 }]} />
                <View style={[styles.gl, { top: '33.3%', left: 0, right: 0, height: 1 }]} />
                <View style={[styles.gl, { top: '66.6%', left: 0, right: 0, height: 1 }]} />
              </Animated.View>
            </GestureDetector>
          </View>
        </View>
        <View style={styles.chips}>
          {ASPECTS.map(a => (
            <Pressable key={a.key} onPress={() => setAspectKey(a.key)} style={[styles.chip, a.key === aspectKey && styles.chipOn]}>
              {a.key === 'free' ? <Ionicons name="expand" size={14} color="#fff" /> : null}
              <Text style={styles.chipText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bar: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  link: { color: '#fff', fontSize: 16 },
  window: { position: 'absolute', left: 0, top: 0, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.06)' },
  gl: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.4)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#1d212c' },
  chipOn: { backgroundColor: '#5b5bd6' },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})

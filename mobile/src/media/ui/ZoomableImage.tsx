import { Image } from 'expo-image'
import { useCallback } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

interface Props {
  uri: string
  blurhash?: string
  /** Natural size, used for pan bounds. Falls back to the screen. */
  width?: number
  height?: number
  onZoomedChange?: (zoomed: boolean) => void
  onSingleTap?: () => void
}

const MAX_SCALE = 5

/** Pinch, double-tap and pan-when-zoomed image. At 1x it never claims pan gestures so paging/dismiss keep working. */
export function ZoomableImage({ uri, blurhash, width, height, onZoomedChange, onSingleTap }: Props) {
  const { width: sw, height: sh } = useWindowDimensions()
  const scale = useSharedValue(1)
  const baseScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const baseTx = useSharedValue(0)
  const baseTy = useSharedValue(0)

  // Rendered (contain-fit) size, to bound the pan.
  const natW = width && width > 0 ? width : sw
  const natH = height && height > 0 ? height : sh
  const fit = Math.min(sw / natW, sh / natH)
  const dispW = natW * fit
  const dispH = natH * fit

  const notify = useCallback((z: boolean) => onZoomedChange?.(z), [onZoomedChange])

  const clampPan = (s: number, x: number, y: number) => {
    'worklet'
    const maxX = Math.max(0, (dispW * s - sw) / 2)
    const maxY = Math.max(0, (dispH * s - sh) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
  }

  const reset = () => {
    'worklet'
    scale.set(withTiming(1, { duration: 180 }))
    tx.set(withTiming(0, { duration: 180 }))
    ty.set(withTiming(0, { duration: 180 }))
    scheduleOnRN(notify, false)
  }

  const pinch = Gesture.Pinch()
    .onStart(() => {
      baseScale.set(scale.get())
    })
    .onUpdate(e => {
      const s = Math.max(0.8, Math.min(MAX_SCALE, baseScale.get() * e.scale))
      scale.set(s)
      const c = clampPan(s, tx.get(), ty.get())
      tx.set(c.x)
      ty.set(c.y)
    })
    .onEnd(() => {
      if (scale.get() < 1.02) reset()
      else scheduleOnRN(notify, true)
    })

  const pan = Gesture.Pan()
    .minPointers(1)
    .onStart(() => {
      baseTx.set(tx.get())
      baseTy.set(ty.get())
    })
    .onUpdate(e => {
      if (scale.get() <= 1.02) return
      const c = clampPan(scale.get(), baseTx.get() + e.translationX, baseTy.get() + e.translationY)
      tx.set(c.x)
      ty.set(c.y)
    })
    // Only claim the touch once zoomed; at 1x the parent pager / dismiss gesture owns it.
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (scale.get() > 1.02) state.activate()
      else state.fail()
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(220)
    .onEnd((e, ok) => {
      if (!ok) return
      if (scale.get() > 1.02) {
        reset()
      } else {
        const target = 2.5
        const c = clampPan(target, (sw / 2 - e.x) * (target - 1), (sh / 2 - e.y) * (target - 1))
        scale.set(withTiming(target, { duration: 200 }))
        tx.set(withTiming(c.x, { duration: 200 }))
        ty.set(withTiming(c.y, { duration: 200 }))
        scheduleOnRN(notify, true)
      }
    })
  const singleTap = Gesture.Tap().onEnd((_e, ok) => {
    if (ok && onSingleTap) scheduleOnRN(onSingleTap)
  })

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap))

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Image
          source={{ uri }}
          placeholder={blurhash ? { blurhash } : undefined}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
        />
      </Animated.View>
    </GestureDetector>
  )
}

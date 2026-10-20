import { useEffect, type ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler'
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import {
  clampToViewport, dismissZone, overDismiss, snapToCorner, snapToEdge,
  type Insets, type Point, type Size,
} from '../snap'

type Props = {
  size: Size
  viewport: Size
  insets: Insets
  /** corner: self-view (4 corners). edge: minimised call window (left/right edge, free vertical). */
  mode: 'corner' | 'edge'
  initial: Point
  /** 0..1 while the finger is down on the tile (parent can show the dismiss target). */
  dragging?: SharedValue<number>
  /** 0..1 while the tile is over the dismiss target. */
  over?: SharedValue<number>
  dismissable?: boolean
  onDismiss?: () => void
  onTap?: () => void
  children: ReactNode
}

const SPRING = { damping: 20, stiffness: 240, mass: 0.8 }

/**
 * A tile that follows the finger on the UI thread, carries release velocity, and
 * springs to its resting place. All maths is in snap.ts (worklet-annotated pure
 * functions, unit-tested), so nothing crosses to JS during the drag.
 */
export function Draggable({
  size, viewport, insets, mode, initial, dragging: draggingProp, over: overProp, dismissable, onDismiss, onTap, children,
}: Props) {
  const x = useSharedValue(initial.x)
  const y = useSharedValue(initial.y)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  const ownDragging = useSharedValue(0)
  const ownOver = useSharedValue(0)
  const dragging = draggingProp ?? ownDragging
  const over = overProp ?? ownOver

  // Re-settle if the window changes (PiP, rotation, keyboard).
  useEffect(() => {
    const cur = { x: x.value, y: y.value }
    const clamped = clampToViewport(cur, size, viewport, insets)
    const t = mode === 'corner' ? snapToCorner(clamped, { x: 0, y: 0 }, size, viewport, insets) : snapToEdge(clamped, { x: 0, y: 0 }, size, viewport, insets)
    x.value = withSpring(t.x, SPRING)
    y.value = withSpring(t.y, SPRING)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.w, viewport.h, size.w, size.h, insets.top, insets.bottom])

  const pan = usePanGesture({
    minDistance: 6,
    onBegin: () => {
      'worklet'
      cancelAnimation(x)
      cancelAnimation(y)
      startX.value = x.value
      startY.value = y.value
    },
    onActivate: () => {
      'worklet'
      dragging.value = withTiming(1, { duration: 140 })
    },
    onUpdate: (e) => {
      'worklet'
      const p = clampToViewport({ x: startX.value + e.translationX, y: startY.value + e.translationY }, size, viewport, insets)
      x.value = p.x
      y.value = p.y
      if (dismissable) {
        const hit = overDismiss(p, size, dismissZone(viewport, insets))
        const next = hit ? 1 : 0
        if (over.value !== next) over.value = withSpring(next, { damping: 14, stiffness: 300 })
      }
    },
    onDeactivate: (e) => {
      'worklet'
      dragging.value = withTiming(0, { duration: 160 })
      const p = { x: x.value, y: y.value }
      if (dismissable && overDismiss(p, size, dismissZone(viewport, insets))) {
        over.value = withTiming(0, { duration: 120 })
        if (onDismiss) scheduleOnRN(onDismiss)
        return
      }
      over.value = withTiming(0, { duration: 120 })
      // px/s from the gesture -> px/ms for the projection helpers.
      const v = { x: e.velocityX / 1000, y: e.velocityY / 1000 }
      const t = mode === 'corner' ? snapToCorner(p, v, size, viewport, insets) : snapToEdge(p, v, size, viewport, insets)
      x.value = withSpring(t.x, { ...SPRING, velocity: e.velocityX })
      y.value = withSpring(t.y, { ...SPRING, velocity: e.velocityY })
    },
  })

  const tap = useTapGesture({
    maxDistance: 10,
    onDeactivate: (_e) => {
      'worklet'
      if (onTap) scheduleOnRN(onTap)
    },
  })

  const gesture = useExclusiveGestures(pan, tap)

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + 0.05 * dragging.value },
    ],
    shadowOpacity: 0.25 + 0.2 * dragging.value,
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.tile, { width: size.w, height: size.h }, style]}>{children}</Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  tile: {
    position: 'absolute', left: 0, top: 0, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1b1f2a',
    shadowColor: '#000', shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
})

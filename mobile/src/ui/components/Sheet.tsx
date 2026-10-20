import { useEffect, useState, type ReactNode } from 'react'
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { haptic } from '../lib/haptics'
import { radius, useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { ListItem } from './ListItem'
import { Text } from './Text'

const SCREEN_H = Dimensions.get('window').height

/**
 * Bottom sheet with drag-to-dismiss. Rendered in a transparent Modal so it sits above
 * navigation chrome; the Modal gets its own GestureHandlerRootView (required on Android).
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(visible)
  const y = useSharedValue(SCREEN_H)
  const height = useSharedValue(400)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      y.value = withSpring(0, { damping: 28, stiffness: 260, mass: 0.9 })
    } else if (mounted) {
      y.value = withTiming(height.value + 40, { duration: 220, easing: Easing.in(Easing.cubic) }, fin => {
        if (fin) runOnJS(setMounted)(false)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetX([-20, 20])
    .onUpdate(e => {
      y.value = Math.max(0, e.translationY)
    })
    .onEnd(e => {
      if (e.translationY > height.value * 0.3 || e.velocityY > 900) {
        runOnJS(onClose)()
      } else {
        y.value = withSpring(0, { damping: 28, stiffness: 300 })
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, height.value], [1, 0], 'clamp') }))

  if (!mounted) return null
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        </Animated.View>
        <View style={styles.bottom} pointerEvents="box-none">
          <Animated.View
            onLayout={e => (height.value = e.nativeEvent.layout.height)}
            style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + 12, borderColor: t.hairline }, sheetStyle]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.handleArea} accessible accessibilityLabel="Drag down to close" accessibilityRole="adjustable">
                <View style={[styles.handle, { backgroundColor: t.border }]} />
                {title ? (
                  <Text variant="h2" style={{ marginTop: 10 }} accessibilityRole="header">
                    {title}
                  </Text>
                ) : null}
              </View>
            </GestureDetector>
            {children}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

export interface SheetAction {
  label: string
  icon: IconName
  onPress: () => void
  destructive?: boolean
}

/** Convenience: a sheet that lists actions and closes itself after one is chosen. */
export function ActionSheet({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title?: string; actions: SheetAction[] }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingTop: 8 }}>
        {actions.map(a => (
          <ListItem
            key={a.label}
            title={a.label}
            icon={a.icon}
            destructive={a.destructive}
            onPress={() => {
              haptic.tap()
              onClose()
              setTimeout(a.onPress, 160)
            }}
          />
        ))}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  bottom: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: StyleSheet.hairlineWidth, maxHeight: '90%' },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6, paddingHorizontal: 20, alignSelf: 'stretch' },
  handle: { width: 40, height: 5, borderRadius: 3 },
})

export { Icon }

import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { useTheme } from '../../theme'

function Dot({ delay, color }: { delay: number; color: string }) {
  const v = useSharedValue(0)
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 260 })), -1),
    )
  }, [delay, v])
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * v.value }], opacity: 0.45 + 0.55 * v.value }))
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />
}

export function TypingIndicator({ name }: { name?: string }) {
  const t = useTheme()
  return (
    <View style={styles.row} accessible accessibilityLabel={`${name ?? 'Contact'} is typing`} accessibilityLiveRegion="polite">
      <View style={[styles.bubble, { backgroundColor: t.bubbleIn, borderColor: t.hairline }]}>
        <Dot delay={0} color={t.muted} />
        <Dot delay={140} color={t.muted} />
        <Dot delay={280} color={t.muted} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, marginTop: 8, flexDirection: 'row' },
  bubble: { flexDirection: 'row', gap: 5, alignItems: 'center', height: 38, paddingHorizontal: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 4 },
})

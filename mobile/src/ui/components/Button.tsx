import { LinearGradient } from 'expo-linear-gradient'
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { haptic } from '../lib/haptics'
import { gradient, radius, useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light' | 'glass'

interface Props {
  title: string
  onPress?: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  icon?: IconName
  small?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityHint?: string
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, small, style, accessibilityHint }: Props) {
  const t = useTheme()
  const scale = useSharedValue(1)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  const off = disabled || loading
  const height = small ? 40 : 54
  const fg = variant === 'primary' || variant === 'glass' ? '#fff' : variant === 'light' ? '#5b5bd6' : variant === 'danger' ? t.danger : variant === 'ghost' ? t.primary : t.ink
  const bg = variant === 'light' ? '#fff' : variant === 'glass' ? 'rgba(255,255,255,0.2)' : variant === 'secondary' ? t.surfaceAlt : variant === 'danger' ? t.dangerSoft : 'transparent'

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPressIn={() => (scale.value = withSpring(0.97, { damping: 20, stiffness: 400 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 15, stiffness: 300 }))}
      onPress={() => {
        haptic.tap()
        onPress?.()
      }}
      style={[{ height, borderRadius: radius.md, opacity: disabled && !loading ? 0.5 : 1, overflow: 'hidden' }, anim, style]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />
      )}
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
        {!loading && (
          <Text weight="bold" color={fg} style={{ fontSize: small ? 14 : 16 }}>
            {title}
          </Text>
        )}
      </View>
    </AnimatedPressable>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
})

import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IrisMark } from '@/components/IrisMark'
import { Button } from '@/ui/components/Button'
import { Icon, type IconName } from '@/ui/components/Icon'
import { Text } from '@/ui/components/Text'
import { gradient } from '@/ui/theme'

const POINTS: Array<{ icon: IconName; text: string }> = [
  { icon: 'lock-closed', text: 'End-to-end encrypted by default' },
  { icon: 'shield-checkmark', text: 'Verify contacts with safety numbers' },
  { icon: 'eye-off', text: 'No phone number, no tracking' },
]

export default function Welcome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.root, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
      <Animated.View entering={FadeIn.duration(600)} style={styles.brand}>
        <IrisMark size={112} dark />
        <Text variant="title" color="#fff" style={{ fontSize: 40, lineHeight: 46 }}>
          Iris
        </Text>
        <Text variant="body" color="rgba(255,255,255,0.85)" align="center" weight="medium">
          Private messages, end to end.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(250).springify().damping(18)} style={styles.points}>
        {POINTS.map(p => (
          <View key={p.text} style={styles.point}>
            <View style={styles.pointIcon}>
              <Icon name={p.icon} size={18} color="#fff" />
            </View>
            <Text color="#fff" weight="semibold" style={{ flex: 1 }}>
              {p.text}
            </Text>
          </View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(400).springify().damping(18)} style={styles.actions}>
        <Button title="Create account" variant="light" onPress={() => router.push("/signup")} />
        <Button title="I already have an account" variant="glass" onPress={() => router.push('/login')} />
        <Text variant="caption" color="rgba(255,255,255,0.75)" align="center">
          Open source, GPL-3.0. Your keys never leave this device.
        </Text>
      </Animated.View>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },
  brand: { alignItems: 'center', gap: 8 },
  points: { gap: 14 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  actions: { gap: 10 },
  primary: { backgroundColor: '#fff' },
})

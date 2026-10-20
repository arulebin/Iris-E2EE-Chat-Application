import { LinearGradient } from 'expo-linear-gradient'
import { memo } from 'react'
import { StyleSheet, View } from 'react-native'
import { hashString, initials } from '../lib/validation'
import { useTheme } from '../theme'
import { Text } from './Text'

// Hue pairs sampled around the Iris brand so avatars feel related but distinguishable.
const PALETTE: Array<[string, string]> = [
  ['#5B5BD6', '#9D7BFF'],
  ['#0EA5E9', '#6366F1'],
  ['#EC4899', '#8B5CF6'],
  ['#F59E0B', '#EF4444'],
  ['#10B981', '#0EA5E9'],
  ['#14B8A6', '#6366F1'],
  ['#F43F5E', '#F59E0B'],
  ['#8B5CF6', '#EC4899'],
]

export function avatarColors(seed: string): [string, string] {
  return PALETTE[hashString(seed) % PALETTE.length]!
}

interface Props {
  name: string
  /** Stable seed for the color (defaults to name). */
  seed?: string
  size?: number
  online?: boolean
  group?: boolean
  /** Use the brand gradient instead of a hashed one. */
  brand?: boolean
}

export const Avatar = memo(function Avatar({ name, seed, size = 48, online, group, brand }: Props) {
  const t = useTheme()
  const [a, b] = brand ? (['#5B5BD6', '#9D7BFF'] as [string, string]) : avatarColors(seed ?? name)
  const dot = Math.max(10, Math.round(size * 0.28))
  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={`${name}${online ? ', online' : ''}`}>
      <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fill, { borderRadius: size / 2 }]}>
        <Text weight="bold" color="#fff" style={{ fontSize: size * 0.38, lineHeight: size * 0.5 }}>
          {group ? '#' : initials(name)}
        </Text>
      </LinearGradient>
      {online ? (
        <View
          style={[
            styles.dot,
            { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: t.online, borderColor: t.bg, borderWidth: Math.max(2, size / 24) },
          ]}
        />
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -1, bottom: -1 },
})

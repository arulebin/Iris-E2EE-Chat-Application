import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { haptic } from '../lib/haptics'
import { useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export function IconButton({
  name,
  onPress,
  label,
  color,
  size = 24,
  badge,
}: {
  name: IconName
  onPress: () => void
  label: string
  color?: string
  size?: number
  badge?: number
}) {
  const t = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        haptic.tap()
        onPress()
      }}
      android_ripple={{ color: t.hairline, borderless: true, radius: 22 }}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
    >
      <Icon name={name} size={size} color={color ?? t.ink} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: t.danger, borderColor: t.bg }]}>
          <Text variant="caption" weight="bold" color="#fff" style={{ fontSize: 10, lineHeight: 13 }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

/** Screen header with back button, title and optional trailing actions. */
export function Header({
  title,
  subtitle,
  right,
  onBack,
  large,
  noBack,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  onBack?: () => void
  large?: boolean
  noBack?: boolean
}) {
  const router = useRouter()
  return (
    <View style={styles.header}>
      {!noBack && <IconButton name="chevron-back" label="Back" onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))} />}
      <View style={[styles.titleWrap, noBack && { paddingLeft: 12 }]}>
        <Text variant={large ? 'h1' : 'h2'} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  titleWrap: { flex: 1, paddingHorizontal: 6 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
})

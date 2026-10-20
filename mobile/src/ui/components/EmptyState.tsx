import { StyleSheet, View } from 'react-native'
import { useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  const t = useTheme()
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${title}. ${body ?? ''}`}>
      <View style={[styles.circle, { backgroundColor: t.primarySoft }]}>
        <Icon name={icon} size={34} color={t.primary} />
      </View>
      <Text variant="h2">{title}</Text>
      {body ? (
        <Text tone="muted" align="center">
          {body}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingHorizontal: 40, paddingTop: 80 },
  circle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
})

import { View } from 'react-native'
import { useTheme } from '../theme'
import { Text } from './Text'

export function Badge({ count, muted, label }: { count?: number; muted?: boolean; label?: string }) {
  const t = useTheme()
  const text = label ?? (count && count > 99 ? '99+' : String(count ?? ''))
  if (!label && !count) return null
  return (
    <View
      accessibilityLabel={label ?? `${count} unread`}
      style={{
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: muted ? t.muted : t.primary,
      }}
    >
      <Text variant="caption" weight="bold" color="#fff">
        {text}
      </Text>
    </View>
  )
}

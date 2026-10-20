import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Switch, View } from 'react-native'
import { haptic } from '../lib/haptics'
import { useTheme } from '../theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

interface Props {
  title: string
  subtitle?: string
  icon?: IconName
  iconBg?: string
  left?: ReactNode
  right?: ReactNode
  onPress?: () => void
  onLongPress?: () => void
  /** Renders a trailing Switch. */
  value?: boolean
  onValueChange?: (v: boolean) => void
  chevron?: boolean
  destructive?: boolean
  disabled?: boolean
  accessibilityHint?: string
}

export function ListItem({ title, subtitle, icon, iconBg, left, right, onPress, onLongPress, value, onValueChange, chevron, destructive, disabled, accessibilityHint }: Props) {
  const t = useTheme()
  const isSwitch = value !== undefined && !!onValueChange
  const tint = destructive ? t.danger : t.ink
  return (
    <Pressable
      disabled={disabled || (!onPress && !onLongPress && !isSwitch)}
      onPress={() => {
        if (isSwitch) {
          haptic.select()
          onValueChange!(!value)
        } else onPress?.()
      }}
      onLongPress={onLongPress}
      accessibilityRole={isSwitch ? 'switch' : onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={isSwitch ? { checked: value, disabled } : { disabled }}
      android_ripple={{ color: t.hairline }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surfaceAlt : 'transparent', opacity: disabled ? 0.5 : 1 }]}
    >
      {left ??
        (icon ? (
          <View style={[styles.icon, { backgroundColor: iconBg ?? t.primarySoft }]}>
            <Icon name={icon} size={20} color={destructive ? t.danger : iconBg ? '#fff' : t.primary} />
          </View>
        ) : null)}
      <View style={styles.body}>
        <Text variant="bodyStrong" color={tint} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {isSwitch ? (
        <Switch
          value={value}
          onValueChange={v => {
            haptic.select()
            onValueChange!(v)
          }}
          disabled={disabled}
          trackColor={{ false: t.border, true: t.primary }}
          thumbColor="#fff"
          accessible={false}
        />
      ) : (
        right
      )}
      {chevron && <Icon name="chevron-forward" size={18} color={t.muted} />}
    </Pressable>
  )
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const t = useTheme()
  return (
    <View style={{ marginTop: 20 }}>
      {title ? (
        <Text variant="overline" tone="muted" style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={{ backgroundColor: t.card, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.hairline }}>{children}</View>
      {footer ? (
        <Text variant="caption" tone="muted" style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 1 },
})

import { forwardRef, useState, type ComponentRef } from 'react'
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import { fonts, radius, useTheme } from '../theme'
import { Icon } from './Icon'
import { Text } from './Text'

interface Props extends TextInputProps {
  label?: string
  hint?: string
  /** 'ok' | 'error' tints the border and hint. */
  state?: 'ok' | 'error' | 'idle'
  secure?: boolean
  trailing?: React.ReactNode
}

/** Labelled text input with validation hint and password reveal. */
export const Field = forwardRef<ComponentRef<typeof TextInput>, Props>(function Field({ label, hint, state = 'idle', secure, trailing, style, ...rest }, ref) {
  const t = useTheme()
  const [focus, setFocus] = useState(false)
  const [reveal, setReveal] = useState(false)
  const border = state === 'error' ? t.danger : state === 'ok' ? t.success : focus ? t.primary : t.border
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text variant="caption" tone="muted" weight="semibold">
          {label}
        </Text>
      ) : null}
      <View style={[styles.box, { borderColor: border, backgroundColor: t.surface }]}>
        <TextInput
          ref={ref}
          placeholderTextColor={t.muted}
          selectionColor={t.primary}
          accessibilityLabel={label ?? rest.placeholder}
          {...rest}
          secureTextEntry={secure && !reveal}
          onFocus={e => {
            setFocus(true)
            rest.onFocus?.(e)
          }}
          onBlur={e => {
            setFocus(false)
            rest.onBlur?.(e)
          }}
          style={[styles.input, { color: t.ink, fontFamily: fonts.medium }, style]}
        />
        {trailing}
        {secure && (
          <Pressable onPress={() => setReveal(r => !r)} hitSlop={10} accessibilityRole="button" accessibilityLabel={reveal ? 'Hide password' : 'Show password'}>
            <Icon name={reveal ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.muted} />
          </Pressable>
        )}
      </View>
      {hint ? (
        <Text variant="caption" color={state === 'error' ? t.danger : state === 'ok' ? t.success : t.muted} accessibilityLiveRegion="polite">
          {hint}
        </Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 54, gap: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
})

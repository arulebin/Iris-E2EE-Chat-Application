import { Text as RNText, type TextProps, type TextStyle } from 'react-native'
import { fonts, type Weight, type Theme, useTheme, type } from '../theme'

type Variant = keyof typeof type
type Tone = 'ink' | 'soft' | 'muted' | 'primary' | 'danger' | 'onPrimary' | 'success'

export interface AppTextProps extends TextProps {
  variant?: Variant
  tone?: Tone
  weight?: Weight
  color?: string
  align?: TextStyle['textAlign']
}

function toneColor(t: Theme, tone: Tone) {
  switch (tone) {
    case 'soft':
      return t.inkSoft
    case 'muted':
      return t.muted
    case 'primary':
      return t.primary
    case 'danger':
      return t.danger
    case 'onPrimary':
      return t.onPrimary
    case 'success':
      return t.success
    default:
      return t.ink
  }
}

/** Themed text using Plus Jakarta Sans. Prefer `variant` + `tone` over ad-hoc styles. */
export function Text({ variant = 'body', tone = 'ink', weight, color, align, style, ...rest }: AppTextProps) {
  const t = useTheme()
  return (
    <RNText
      {...rest}
      style={[type[variant], { color: color ?? toneColor(t, tone) }, weight && { fontFamily: fonts[weight] }, align && { textAlign: align }, style]}
    />
  )
}

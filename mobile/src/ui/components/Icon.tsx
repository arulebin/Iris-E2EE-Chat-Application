import Ionicons from '@expo/vector-icons/Ionicons'
import type { ComponentProps } from 'react'
import { useTheme } from '../theme'

export type IconName = ComponentProps<typeof Ionicons>['name']

export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const t = useTheme()
  return <Ionicons name={name} size={size} color={color ?? t.ink} />
}

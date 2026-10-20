import { useColorScheme } from 'react-native'

/** Iris design tokens, mirrored from frontend/src/index.css. */
export const gradient = ['#5B5BD6', '#7C5CFF', '#9D7BFF'] as const

const light = {
  bg: '#f7f8fb',
  card: '#ffffff',
  primary: '#5b5bd6',
  ink: '#14181f',
  muted: '#8a93a3',
  hairline: '#c9d0db',
  online: '#10b981',
  danger: '#dc2626',
  onPrimary: '#ffffff',
}

const dark: typeof light = {
  bg: '#0b0d12',
  card: '#161922',
  primary: '#5b5bd6',
  ink: '#e7eaf1',
  muted: '#8b93a3',
  hairline: '#2c3340',
  online: '#22c55e',
  danger: '#f87171',
  onPrimary: '#ffffff',
}

export type Theme = typeof light & { isDark: boolean }

export function useTheme(): Theme {
  const scheme = useColorScheme()
  return scheme === 'dark' ? { ...dark, isDark: true } : { ...light, isDark: false }
}

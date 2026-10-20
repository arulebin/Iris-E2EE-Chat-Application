import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme, type TextStyle } from 'react-native'
import type { ThemeMode } from '@/state/services'

/** Iris design tokens, mirrored from frontend/src/index.css. */
export const gradient = ['#5B5BD6', '#7C5CFF', '#9D7BFF'] as const

const light = {
  bg: '#f7f8fb',
  surface: '#ffffff',
  card: '#ffffff',
  surfaceAlt: '#eef0f6',
  primary: '#5b5bd6',
  primarySoft: '#e9e9fb',
  ink: '#14181f',
  inkSoft: '#3b4252',
  muted: '#8a93a3',
  hairline: '#e3e7ee',
  border: '#c9d0db',
  online: '#10b981',
  danger: '#dc2626',
  dangerSoft: '#fde8e8',
  warning: '#d97706',
  success: '#16a34a',
  onPrimary: '#ffffff',
  bubbleIn: '#ffffff',
  bubbleInInk: '#14181f',
  bubbleOut: '#5b5bd6',
  bubbleOutInk: '#ffffff',
  bubbleOutMuted: 'rgba(255,255,255,0.72)',
  chatBg: '#eef0f7',
  tick: '#8a93a3',
  tickRead: '#7fd3ff',
  overlay: 'rgba(11,13,18,0.45)',
  shadow: '#0b0d12',
}

const dark: typeof light = {
  bg: '#0b0d12',
  surface: '#12151c',
  card: '#161922',
  surfaceAlt: '#1d2230',
  primary: '#6e6ee6',
  primarySoft: '#23233f',
  ink: '#e7eaf1',
  inkSoft: '#c3c9d6',
  muted: '#8b93a3',
  hairline: '#232936',
  border: '#2c3340',
  online: '#22c55e',
  danger: '#f87171',
  dangerSoft: '#3a1c1f',
  warning: '#f59e0b',
  success: '#4ade80',
  onPrimary: '#ffffff',
  bubbleIn: '#1b1f2b',
  bubbleInInk: '#e7eaf1',
  bubbleOut: '#5b5bd6',
  bubbleOutInk: '#ffffff',
  bubbleOutMuted: 'rgba(255,255,255,0.7)',
  chatBg: '#0e1118',
  tick: '#8b93a3',
  tickRead: '#7fd3ff',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
}

export type Theme = typeof light & { isDark: boolean }

export const radius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 } as const
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

/** Plus Jakarta Sans weights, as loaded in the root layout. */
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const

export type Weight = keyof typeof fonts

export const type = {
  title: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6, fontFamily: fonts.extrabold } satisfies TextStyle,
  h1: { fontSize: 24, lineHeight: 30, letterSpacing: -0.4, fontFamily: fonts.bold } satisfies TextStyle,
  h2: { fontSize: 18, lineHeight: 24, fontFamily: fonts.bold } satisfies TextStyle,
  body: { fontSize: 16, lineHeight: 22, fontFamily: fonts.regular } satisfies TextStyle,
  bodyStrong: { fontSize: 16, lineHeight: 22, fontFamily: fonts.semibold } satisfies TextStyle,
  small: { fontSize: 14, lineHeight: 19, fontFamily: fonts.regular } satisfies TextStyle,
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.medium } satisfies TextStyle,
  overline: { fontSize: 12, lineHeight: 16, letterSpacing: 0.8, fontFamily: fonts.bold } satisfies TextStyle,
}

const ThemeModeContext = createContext<ThemeMode>('system')

export function ThemeProvider({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  return <ThemeModeContext.Provider value={mode}>{children}</ThemeModeContext.Provider>
}

const LIGHT: Theme = { ...light, isDark: false }
const DARK: Theme = { ...dark, isDark: true }

export function resolveTheme(mode: ThemeMode, system: 'light' | 'dark' | null | undefined): Theme {
  const dark = mode === 'system' ? system === 'dark' : mode === 'dark'
  return dark ? DARK : LIGHT
}

export function useTheme(): Theme {
  const mode = useContext(ThemeModeContext)
  const system = useColorScheme()
  return useMemo(() => resolveTheme(mode, system), [mode, system])
}

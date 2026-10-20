import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { haptic } from '../lib/haptics'
import { radius, useTheme } from '../theme'
import { Icon } from './Icon'
import { Text } from './Text'

type Kind = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  text: string
  kind: Kind
}

interface ToastApi {
  show: (text: string, kind?: Kind) => void
}

const ToastContext = createContext<ToastApi>({ show: () => {} })

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const insets = useSafeAreaInsets()
  const t = useTheme()

  const show = useCallback((text: string, kind: Kind = 'info') => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ id: ++seq.current, text, kind })
    if (kind === 'success') haptic.success()
    else if (kind === 'error') haptic.error()
    AccessibilityInfo.announceForAccessibility(text)
    timer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const api = useMemo(() => ({ show }), [show])
  const color = toast?.kind === 'error' ? t.danger : toast?.kind === 'success' ? t.success : t.primary
  return (
    <ToastContext.Provider value={api}>
      {children}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 8, alignItems: 'center' }]}>
        {toast && (
          <Animated.View
            key={toast.id}
            entering={FadeInUp.springify().damping(18)}
            exiting={FadeOutUp.duration(180)}
            accessibilityRole="alert"
            style={[styles.toast, { backgroundColor: t.isDark ? t.surfaceAlt : '#14181f', borderColor: t.hairline }]}
          >
            <Icon name={toast.kind === 'error' ? 'alert-circle' : toast.kind === 'success' ? 'checkmark-circle' : 'information-circle'} size={20} color={color} />
            <Text variant="small" weight="semibold" color="#fff" style={{ flexShrink: 1 }}>
              {toast.text}
            </Text>
          </Animated.View>
        )}
      </View>
    </ToastContext.Provider>
  )
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '90%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
})

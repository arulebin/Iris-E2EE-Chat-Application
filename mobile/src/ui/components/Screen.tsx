import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme'

/** Root container: themed background plus safe-area padding on the requested edges. */
export function Screen({
  children,
  edges = ['top', 'bottom'],
  style,
  bg,
}: {
  children: ReactNode
  edges?: Array<'top' | 'bottom'>
  style?: StyleProp<ViewStyle>
  bg?: string
}) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: bg ?? t.bg, paddingTop: edges.includes('top') ? insets.top : 0, paddingBottom: edges.includes('bottom') ? insets.bottom : 0 },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })

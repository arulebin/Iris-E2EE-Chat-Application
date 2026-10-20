import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme'
import { useNativeUpdate, useOtaUpdates } from './useUpdates'

/**
 * Non-blocking banner mounted once in the root layout. Two cases:
 *  - a verified OTA bundle was downloaded: "Restart to update" (otherwise it applies on
 *    the next cold start);
 *  - a newer binary exists: "Update available" (opens Play / GitHub Releases).
 */
export function UpdateBanner() {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const ota = useOtaUpdates()
  const native = useNativeUpdate()

  const nativeShown = native.available
  if (!ota.pending && !nativeShown) return null

  const message = nativeShown
    ? `Iris ${native.info?.latestVersion ?? ''} is available${native.required ? ' (required)' : ''}`
    : 'Update ready'
  const action = nativeShown ? 'Update' : 'Restart to update'

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 12 }]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
        <Text style={[styles.text, { color: t.ink }]}>{message}</Text>
        <Pressable onPress={nativeShown ? native.open : ota.restart} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.action, { color: t.primary }]}>{action}</Text>
        </Pressable>
        {nativeShown && !native.required ? (
          <Pressable onPress={native.dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={{ color: t.muted, fontWeight: '700' }}>Later</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
  },
  text: { fontSize: 14, flexShrink: 1 },
  action: { fontWeight: '800' },
})

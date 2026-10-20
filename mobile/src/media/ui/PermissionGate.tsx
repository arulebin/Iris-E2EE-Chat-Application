import { Ionicons } from '@expo/vector-icons'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface Props {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
  /** True once the OS will no longer show the prompt: the only way forward is system settings. */
  blocked: boolean
  onAllow: () => void
  onClose: () => void
  allowLabel?: string
}

/** Friendly rationale screen shown before (or instead of) the OS permission prompt. */
export function PermissionGate({ icon, title, body, blocked, onAllow, onClose, allowLabel = 'Continue' }: Props) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityLabel="Close">
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>
      <View style={styles.center}>
        <View style={styles.badge}>
          <Ionicons name={icon} size={40} color="#fff" />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Pressable
        onPress={blocked ? () => void Linking.openSettings() : onAllow}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>{blocked ? 'Open settings' : allowLabel}</Text>
      </Pressable>
      <Pressable onPress={onClose} style={styles.later} accessibilityRole="button">
        <Text style={styles.laterText}>Not now</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0d12', paddingHorizontal: 28 },
  close: { alignSelf: 'flex-start', padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  badge: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#5b5bd6', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { color: '#aab1c0', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  cta: { backgroundColor: '#5b5bd6', borderRadius: 28, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  later: { paddingVertical: 14, alignItems: 'center' },
  laterText: { color: '#8b93a3', fontSize: 15 },
})

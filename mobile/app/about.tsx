import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme'
import { UpdateInfoCard } from '@/updates'

/** Minimal About screen; the future Settings screen can link here or embed <UpdateInfoCard />. */
export default function About() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Text style={{ color: t.primary, fontWeight: '700' }}>Back</Text>
      </Pressable>
      <Text style={[styles.title, { color: t.ink }]}>About</Text>
      <UpdateInfoCard />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, gap: 12 },
  title: { fontSize: 26, fontWeight: '800' },
})

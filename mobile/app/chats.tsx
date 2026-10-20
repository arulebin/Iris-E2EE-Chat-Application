import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme'

const DEMO = [
  { id: '1', name: 'Mira', last: 'Safety number matched.', time: '09:41', unread: 2, online: true },
  { id: '2', name: 'Dev', last: 'Snap', time: 'Yesterday', unread: 0, online: false },
  { id: '3', name: 'Ana', last: 'See you at 6', time: 'Mon', unread: 0, online: true },
]

// Static shell. The real list arrives with the shared API client in phase 3.
export default function ChatsScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.ink }]}>Chats</Text>
        <Pressable onPress={() => router.push('/diagnostics')} hitSlop={12}>
          <Text style={{ color: t.primary, fontWeight: '700' }}>Diagnostics</Text>
        </Pressable>
      </View>
      <FlatList
        data={DEMO}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
            <Pressable style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.card : 'transparent' }]}>
              <View style={[styles.avatar, { backgroundColor: t.primary }]}>
                <Text style={styles.avatarText}>{item.name[0]}</Text>
                {item.online && <View style={[styles.dot, { backgroundColor: t.online, borderColor: t.bg }]} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: t.ink }]}>{item.name}</Text>
                <Text numberOfLines={1} style={{ color: t.muted }}>{item.last}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={{ color: t.muted, fontSize: 12 }}>{item.time}</Text>
                {item.unread > 0 && (
                  <View style={[styles.badge, { backgroundColor: t.primary }]}>
                    <Text style={styles.badgeText}>{item.unread}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          </Animated.View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  dot: { position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  name: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
})

import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { useContacts, useServices } from '@/state/hooks'
import type { Contact } from '@/state/services'
import { Avatar } from '@/ui/components/Avatar'
import { EmptyState } from '@/ui/components/EmptyState'
import { Header } from '@/ui/components/Header'
import { Icon } from '@/ui/components/Icon'
import { ListItem } from '@/ui/components/ListItem'
import { Screen } from '@/ui/components/Screen'
import { useToast } from '@/ui/components/Toast'
import { fonts, useTheme } from '@/ui/theme'

export default function NewChat() {
  const t = useTheme()
  const router = useRouter()
  const services = useServices()
  const toast = useToast()
  const contactsQ = useContacts()
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (contactsQ.data ?? []).filter(c => !s || c.displayName.toLowerCase().includes(s) || c.username.toLowerCase().includes(s))
  }, [contactsQ.data, q])

  async function open(c: Contact) {
    try {
      const id = await services.chats.openDirect(c.id)
      router.replace({ pathname: '/chat/[id]', params: { id } })
    } catch {
      toast.show('Could not open chat', 'error')
    }
  }

  return (
    <Screen edges={['top']}>
      <Header title="New chat" onBack={() => router.back()} />
      <View style={[styles.search, { backgroundColor: t.surfaceAlt }]}>
        <Icon name="search" size={18} color={t.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search friends"
          placeholderTextColor={t.muted}
          style={[styles.input, { color: t.ink, fontFamily: fonts.medium }]}
          accessibilityLabel="Search friends"
        />
      </View>
      <FlashList
        data={rows}
        keyExtractor={c => c.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          q ? null : (
            <View>
              <ListItem icon="person-add" title="Add a friend" subtitle="With an invite code or username" chevron onPress={() => router.push('/add-contact')} />
              <ListItem icon="people" title="New group" subtitle="Chat with several friends" chevron onPress={() => router.replace('/new-group')} />
            </View>
          )
        }
        ListEmptyComponent={contactsQ.loading ? null : <EmptyState icon="person-outline" title="No friends found" body="Add friends with their invite code to start chatting." />}
        renderItem={({ item }) => (
          <ListItem
            left={<Avatar name={item.displayName} seed={item.id} size={46} online={item.online} />}
            title={item.displayName}
            subtitle={`@${item.username}`}
            onPress={() => open(item)}
          />
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, borderRadius: 22, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 8 },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
})

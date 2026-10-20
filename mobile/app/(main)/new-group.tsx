import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated'
import { useContacts, useServices } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Header } from '@/ui/components/Header'
import { Icon } from '@/ui/components/Icon'
import { ListItem } from '@/ui/components/ListItem'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { useTheme } from '@/ui/theme'

export default function NewGroup() {
  const t = useTheme()
  const router = useRouter()
  const services = useServices()
  const toast = useToast()
  const contactsQ = useContacts()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const ready = name.trim().length > 0 && picked.length > 0

  const toggle = (id: string) => {
    haptic.select()
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  }

  async function create() {
    setBusy(true)
    try {
      const id = await services.groups.create(name.trim(), picked)
      haptic.success()
      router.replace({ pathname: '/chat/[id]', params: { id } })
    } catch {
      toast.show('Could not create the group', 'error')
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="New group" onBack={() => router.back()} />
      <View style={styles.pad}>
        <Field label="Group name" placeholder="Group name" value={name} onChangeText={setName} maxLength={50} returnKeyType="done" />
        <Text variant="overline" tone="muted" style={{ marginTop: 8 }}>
          {picked.length ? `${picked.length} SELECTED` : 'ADD MEMBERS'}
        </Text>
      </View>
      <FlashList
        data={contactsQ.data ?? []}
        extraData={picked}
        keyExtractor={c => c.id}
        renderItem={({ item }) => {
          const on = picked.includes(item.id)
          return (
            <ListItem
              left={<Avatar name={item.displayName} seed={item.id} size={44} online={item.online} />}
              title={item.displayName}
              subtitle={`@${item.username}`}
              onPress={() => toggle(item.id)}
              right={
                <View style={[styles.check, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : 'transparent' }]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  {on ? (
                    <Animated.View entering={ZoomIn.duration(120)}>
                      <Icon name="checkmark" size={16} color="#fff" />
                    </Animated.View>
                  ) : null}
                </View>
              }
            />
          )
        }}
      />
      {ready && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.cta}>
          <Button title={`Create group (${picked.length + 1})`} icon="checkmark" onPress={create} loading={busy} />
        </Animated.View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cta: { paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8 },
})

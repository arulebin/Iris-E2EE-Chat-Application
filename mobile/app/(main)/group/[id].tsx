import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native'
import { useGroup, useServices } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { Header } from '@/ui/components/Header'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Screen } from '@/ui/components/Screen'
import { Sheet } from '@/ui/components/Sheet'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { fonts, radius, useTheme } from '@/ui/theme'

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: '' }

export default function GroupInfo() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useGroup(id)
  const { groups } = useServices()
  const toast = useToast()
  const g = q.data
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')

  function leave() {
    Alert.alert('Leave group?', 'You will stop receiving messages from this group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          haptic.warning()
          await groups.leave(id)
          router.dismissAll()
        },
      },
    ])
  }

  if (!g) return <Screen edges={['top']}><Header title="Group info" /></Screen>
  const canEdit = g.myRole !== 'member'
  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="Group info" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          <Avatar name={g.name} seed={g.id} size={96} group />
          <Text variant="h1">{g.name}</Text>
          <Text tone="muted">{g.members.length} members</Text>
          {canEdit && (
            <Button
              small
              variant="secondary"
              icon="pencil"
              title="Rename"
              onPress={() => {
                setName(g.name)
                setRenaming(true)
              }}
            />
          )}
        </View>

        <Section title="Invite link" footer="Anyone with this link can join. Reset it to revoke the old link.">
          <ListItem icon="link" title={g.inviteLink.replace('https://', '')} subtitle="Tap to share" onPress={() => Share.share({ message: `Join my group on Iris: ${g.inviteLink}` })} />
          <ListItem
            icon="copy"
            title="Copy link"
            onPress={async () => {
              await Clipboard.setStringAsync(g.inviteLink)
              toast.show('Invite link copied', 'success')
            }}
          />
          {canEdit && (
            <ListItem
              icon="refresh"
              title="Reset invite link"
              onPress={async () => {
                await groups.resetInvite(g.id)
                toast.show('New invite link created', 'success')
              }}
            />
          )}
        </Section>

        <Section title={`${g.members.length} members`}>
          {g.members.map(m => (
            <ListItem
              key={m.userId}
              left={<Avatar name={m.displayName} seed={m.userId} size={44} online={m.online} />}
              title={m.isMe ? 'You' : m.displayName}
              subtitle={`@${m.username}`}
              right={
                ROLE[m.role] ? (
                  <View style={[styles.role, { backgroundColor: t.primarySoft }]}>
                    <Text variant="caption" weight="bold" tone="primary">
                      {ROLE[m.role]}
                    </Text>
                  </View>
                ) : undefined
              }
              onPress={!m.isMe ? () => router.push({ pathname: '/safety/[id]', params: { id: m.userId } }) : undefined}
            />
          ))}
        </Section>

        <Section>
          <ListItem icon="exit-outline" title="Leave group" destructive onPress={leave} />
        </Section>
      </ScrollView>

      <Sheet visible={renaming} onClose={() => setRenaming(false)} title="Rename group">
        <View style={{ padding: 20, gap: 14 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={50}
            style={[styles.input, { color: t.ink, borderColor: t.border, fontFamily: fonts.medium }]}
            accessibilityLabel="Group name"
          />
          <Button
            title="Save"
            disabled={!name.trim()}
            onPress={async () => {
              await groups.rename(g.id, name.trim())
              setRenaming(false)
            }}
          />
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  role: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  input: { height: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
})

import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useProfile, useServices } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'

export default function ProfileSettings() {
  const { profile } = useServices()
  const toast = useToast()
  const q = useProfile()
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [busy, setBusy] = useState(false)
  const loaded = q.data

  useEffect(() => {
    if (loaded) {
      setDisplayName(loaded.displayName)
      setBio(loaded.bio)
    }
  }, [loaded?.displayName, loaded?.bio])

  const dirty = !!loaded && (displayName.trim() !== loaded.displayName || bio.trim() !== loaded.bio)

  return (
    <Page title="Profile">
      <View style={styles.hero}>
        <Avatar name={displayName || 'Me'} size={104} brand />
        <Button small variant="secondary" icon="camera" title="Change photo" onPress={() => toast.show('Photos arrive with the media update')} />
      </View>
      <View style={styles.form}>
        <Field label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={40} placeholder="Display name" />
        <Field label="Bio" value={bio} onChangeText={setBio} maxLength={120} placeholder="Say something about yourself" multiline />
        <View style={{ gap: 4 }}>
          <Text variant="caption" tone="muted" weight="semibold">
            Username
          </Text>
          <Text>@{loaded?.username}</Text>
          <Text variant="caption" tone="muted">
            Your username cannot be changed.
          </Text>
        </View>
        <Button
          title="Save"
          disabled={!dirty || !displayName.trim()}
          loading={busy}
          onPress={async () => {
            setBusy(true)
            await profile.update({ displayName: displayName.trim(), bio: bio.trim() })
            setBusy(false)
            toast.show('Profile updated', 'success')
          }}
        />
      </View>
    </Page>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  form: { paddingHorizontal: 20, gap: 20 },
})

import * as Clipboard from 'expo-clipboard'
import { Alert, Share, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { usePrivacy, useServices } from '@/state/hooks'
import { Button } from '@/ui/components/Button'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { fonts, radius, useTheme } from '@/ui/theme'

export default function PrivacySettings() {
  const t = useTheme()
  const { privacy } = useServices()
  const toast = useToast()
  const p = usePrivacy().data

  return (
    <Page title="Privacy">
      <Section title="Who can find you" footer="A private profile hides your name and photo from people who are not your friends.">
        <ListItem icon="eye-off" title="Private profile" value={p?.privateProfile ?? false} onValueChange={v => privacy.setPrivateProfile(v)} disabled={!p} />
        <ListItem icon="person-add" title="Allow invites" subtitle="Let people add you with your invite code" value={p?.allowInvites ?? true} onValueChange={v => privacy.setAllowInvites(v)} disabled={!p} />
      </Section>

      {p ? (
        <Section title="Your invite code" footer={p.allowInvites ? 'Old link and QR will stop working when you create a new code.' : 'Invites are turned off. Turn them on to share your code.'}>
          <View style={[styles.codeCard, { opacity: p.allowInvites ? 1 : 0.4 }]}>
            <View style={styles.qr}>
              <QRCode value={p.inviteUrl} size={168} color="#14181f" backgroundColor="#fff" />
            </View>
            <Text style={[styles.code, { fontFamily: fonts.extrabold }]} selectable accessibilityLabel={`Invite code ${p.inviteCode}`}>
              {p.inviteCode}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
              <Button
                small
                title="Share"
                icon="share-outline"
                style={{ flex: 1 }}
                disabled={!p.allowInvites}
                onPress={() => Share.share({ message: `Add me on Iris: ${p.inviteUrl}` })}
              />
              <Button
                small
                variant="secondary"
                title="Copy"
                icon="copy-outline"
                style={{ flex: 1 }}
                disabled={!p.allowInvites}
                onPress={async () => {
                  await Clipboard.setStringAsync(p.inviteCode)
                  toast.show('Invite code copied', 'success')
                }}
              />
            </View>
          </View>
          <ListItem
            icon="refresh"
            title="Create new code"
            onPress={() =>
              Alert.alert('Create a new code?', 'Your old code, link and QR will stop working.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Create',
                  onPress: async () => {
                    await privacy.rotateInvite()
                    haptic.success()
                    toast.show('New invite code created', 'success')
                  },
                },
              ])
            }
          />
        </Section>
      ) : null}
    </Page>
  )
}

const styles = StyleSheet.create({
  codeCard: { alignItems: 'center', gap: 14, padding: 20 },
  qr: { padding: 14, backgroundColor: '#fff', borderRadius: radius.lg },
  code: { fontSize: 26, letterSpacing: 3, color: '#5b5bd6' },
})

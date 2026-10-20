import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { useBlocked, useProfile, useServices, useSettings } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { Icon } from '@/ui/components/Icon'
import { useToast } from '@/ui/components/Toast'
import { useTheme } from '@/ui/theme'

const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const

export default function Settings() {
  const t = useTheme()
  const router = useRouter()
  const { auth } = useServices()
  const toast = useToast()
  const profile = useProfile().data
  const blocked = useBlocked().data
  const { settings, update } = useSettings()

  return (
    <Page title="Settings">
      <Pressable onPress={() => router.push('/settings/profile')} accessibilityRole="button" accessibilityLabel={`Profile, ${profile?.displayName ?? ''}`} style={[styles.profile, { backgroundColor: t.card, borderColor: t.hairline }]}>
        <Avatar name={profile?.displayName ?? 'Me'} size={64} brand />
        <View style={{ flex: 1 }}>
          <Text variant="h2" numberOfLines={1}>
            {profile?.displayName ?? ' '}
          </Text>
          <Text tone="muted">@{profile?.username}</Text>
          {profile?.bio ? (
            <Text variant="small" tone="soft" numberOfLines={1}>
              {profile.bio}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-forward" size={20} color={t.muted} />
      </Pressable>

      <Section title="Account">
        <ListItem icon="person" title="Profile" subtitle="Name and avatar" chevron onPress={() => router.push('/settings/profile')} />
        <ListItem icon="eye-off" title="Privacy" subtitle="Who can find you, invite code" chevron onPress={() => router.push('/settings/privacy')} />
        <ListItem icon="ban" title="Blocked users" subtitle={blocked?.length ? `${blocked.length} blocked` : 'None'} chevron onPress={() => router.push('/settings/blocked')} />
      </Section>

      <Section title="Security">
        <ListItem icon="lock-closed" title="App lock" subtitle={settings.appLock ? 'On' : 'Off'} chevron onPress={() => router.push('/settings/app-lock')} />
        <ListItem
          icon="shield-half"
          title="Screen security"
          subtitle="Hide content in app switcher, block screenshots"
          value={settings.screenSecurity}
          onValueChange={v => {
            void update({ screenSecurity: v })
            if (!v) toast.show('Screenshots allowed. View-once media and calls stay protected.')
          }}
        />
        <ListItem icon="phone-portrait" title="Linked devices" chevron onPress={() => router.push('/settings/devices')} />
        <ListItem icon="cloud-upload" title="Backup" chevron onPress={() => router.push('/settings/backup')} />
      </Section>

      <Section title="App">
        <ListItem icon="color-palette" title="Appearance" subtitle={THEME_LABEL[settings.theme]} chevron onPress={() => router.push('/settings/appearance')} />
        <ListItem icon="notifications" title="Notifications" value={settings.notifications} onValueChange={v => update({ notifications: v })} />
        <ListItem icon="radio" title="Haptic feedback" value={settings.haptics} onValueChange={v => update({ haptics: v })} />
        <ListItem icon="information-circle" title="About Iris" chevron onPress={() => router.push('/settings/about')} />
      </Section>

      <Section>
        <ListItem icon="lock-closed-outline" title="Lock now" onPress={() => auth.lock()} />
        <ListItem
          icon="log-out-outline"
          title="Sign out"
          destructive
          onPress={() =>
            Alert.alert('Sign out?', 'You will need your password to sign back in.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => auth.logout() },
            ])
          }
        />
      </Section>
      <Text variant="caption" tone="muted" align="center" style={{ marginTop: 24 }}>
        Iris {Constants.expoConfig?.version ?? '0.1.0'}
      </Text>
    </Page>
  )
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginTop: 8, padding: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
})

import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, BackHandler, ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useBackup, useServices } from '@/state/hooks'
import { Button } from '@/ui/components/Button'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { FrequencyPicker, RecoveryKeyView, type FrequencyChoice } from '@/ui/components/backup'
import { haptic } from '@/ui/lib/haptics'
import { useTheme } from '@/ui/theme'

const POINTS: { icon: 'lock-closed' | 'cloud' | 'phone-portrait'; text: string }[] = [
  { icon: 'lock-closed', text: 'End-to-end encrypted with a recovery key only you have. Iris can\'t read it.' },
  { icon: 'cloud', text: 'Stored on Iris\'s server and updated automatically.' },
  { icon: 'phone-portrait', text: 'Your messages live only on this phone. A backup is the only way to get them back if you change or reinstall your phone.' },
]

/**
 * "Back up your chats": offered once after sign-in when the account has no backup anywhere
 * (session.setup === 'backup'; the chat list opens this). Default choice is ON, daily. Declining is final
 * for this phone; Settings keeps a gentle banner instead of asking again.
 */
export default function BackupSetup() {
  const t = useTheme()
  const router = useRouter()
  const { backup } = useServices()
  const status = useBackup().data
  const [choice, setChoice] = useState<FrequencyChoice>('daily')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState<string | null>(null)

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  const finish = async () => {
    await backup.finishSetup('backup')
    close()
  }

  // While the first backup uploads or the key is on screen, back must not drop the user out of the flow.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => busy || !!key)
    return () => sub.remove()
  }, [busy, key])

  async function start() {
    if (choice === 'off') {
      await finish()
      return
    }
    setBusy(true)
    try {
      setKey(await backup.enable(choice))
      haptic.success()
    } catch (e) {
      haptic.error()
      Alert.alert('Backup failed', (e as Error)?.message || 'Try again in Settings → Backup.')
    } finally {
      setBusy(false)
    }
  }

  const notNow = () =>
    Alert.alert('Skip backups?', 'If you lose or reinstall this phone, your messages cannot be recovered. You can turn backups on any time in Settings → Backup.', [
      { text: 'Back up', style: 'cancel' },
      { text: 'Not now', style: 'destructive', onPress: () => void finish() },
    ])

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {key ? (
          <Animated.View entering={FadeIn} style={{ gap: 20 }}>
            <View style={styles.hero}>
              <Icon name="checkmark-circle" size={56} color={t.success} />
              <Text variant="h1" align="center">
                Save your recovery key
              </Text>
              <Text tone="muted" align="center">
                Your first backup is done. You need this key to restore your chats on a new or reinstalled phone.
              </Text>
            </View>
            <RecoveryKeyView recoveryKey={key} onDone={() => void finish()} doneTitle="Done" />
          </Animated.View>
        ) : (
          <>
            <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.hero}>
              <View style={[styles.badge, { backgroundColor: t.primarySoft }]}>
                <Icon name="cloud-upload" size={40} color={t.primary} />
              </View>
              <Text variant="h1" align="center">
                Back up your chats
              </Text>
            </Animated.View>
            <View style={{ gap: 14 }}>
              {POINTS.map(p => (
                <View key={p.icon} style={styles.point}>
                  <Icon name={p.icon} size={22} color={t.primary} />
                  <Text style={{ flex: 1 }} tone="soft">
                    {p.text}
                  </Text>
                </View>
              ))}
            </View>
            {status?.serverBackup ? (
              <Text variant="small" tone="danger">
                A backup from another device already exists. Backing up here replaces it with this phone&apos;s chats.
              </Text>
            ) : null}
            <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
              <Text variant="overline" tone="muted" style={{ paddingHorizontal: 20, paddingTop: 14 }}>
                BACK UP
              </Text>
              <FrequencyPicker value={choice} options={['daily', 'weekly', 'off']} onChange={setChoice} disabled={busy} />
            </View>
            {busy ? (
              <View style={styles.busy} accessibilityLiveRegion="polite">
                <ActivityIndicator color={t.primary} />
                <Text tone="muted">Encrypting and uploading your first backup…</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                <Button title={choice === 'off' ? 'Continue' : 'Back up now'} icon={choice === 'off' ? undefined : 'cloud-upload'} onPress={start} />
                {choice !== 'off' ? <Button title="Not now" variant="ghost" onPress={notNow} /> : null}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 24, flexGrow: 1 },
  hero: { alignItems: 'center', gap: 10 },
  badge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingBottom: 6 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'center', paddingVertical: 14 },
})

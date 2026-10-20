import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useBackup, useServices } from '@/state/hooks'
import type { RestorePhase } from '@/state/services'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { fmtBackupTime, fmtBytes } from '@/ui/components/backup'
import { haptic } from '@/ui/lib/haptics'
import { useTheme } from '@/ui/theme'

const PHASES: { key: RestorePhase; label: string }[] = [
  { key: 'download', label: 'Downloading backup' },
  { key: 'decrypt', label: 'Decrypting on this phone' },
  { key: 'merge', label: 'Restoring messages' },
]

/**
 * Setup step on a new / reinstalled phone when the account has a server backup: shown by the root layout
 * BEFORE the chat list (session.setup === 'restore'). Restoring brings back message history only; this
 * phone keeps its own Signal keys and sessions. Messages that arrive meanwhile are kept (merged).
 */
export default function Restore() {
  const t = useTheme()
  const { backup } = useServices()
  const status = useBackup().data
  const [key, setKey] = useState('')
  const [phase, setPhase] = useState<RestorePhase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState<number | null>(null)

  const busy = phase !== null && restored === null

  async function restore() {
    setError(null)
    setPhase('download')
    try {
      const n = await backup.restore(key, p => setPhase(p))
      haptic.success()
      setRestored(n)
    } catch (e) {
      haptic.error()
      setPhase(null)
      setError((e as Error)?.message || 'Restore failed')
    }
  }

  function skip() {
    Alert.alert(
      'Skip restoring?',
      'Your chats from before will not be on this phone. The backup stays on the server, so you can still restore it later in Settings → Backup.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', style: 'destructive', onPress: () => void backup.finishSetup('restore') },
      ],
    )
  }

  const found = status?.lastBackupAt
    ? `Last backup: ${fmtBackupTime(status.lastBackupAt)}${status.sizeBytes ? ` · ${fmtBytes(status.sizeBytes)}` : ''}`
    : null

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.hero}>
          <View style={[styles.badge, { backgroundColor: t.primarySoft }]}>
            <Icon name="cloud-download" size={40} color={t.primary} />
          </View>
          <Text variant="h1" align="center">
            Restore your chats
          </Text>
          <Text tone="muted" align="center">
            A backup of your chats was found. Enter the recovery key you saved when you turned on backups to bring your messages to this phone.
          </Text>
          {found ? (
            <Text variant="small" tone="soft" align="center">
              {found}
            </Text>
          ) : null}
        </Animated.View>

        {restored !== null ? (
          <Animated.View entering={FadeIn} style={{ gap: 16, alignItems: 'center' }}>
            <Icon name="checkmark-circle" size={56} color={t.success} />
            <Text variant="h2" align="center">
              {restored === 0 ? 'Your chats are up to date' : `Restored ${restored} message${restored === 1 ? '' : 's'}`}
            </Text>
            <Text tone="muted" align="center">
              Backups stay on for this phone, daily. You can change that in Settings → Backup.
            </Text>
            <Button title="Continue" onPress={() => void backup.finishSetup('restore')} style={{ alignSelf: 'stretch' }} />
          </Animated.View>
        ) : busy ? (
          <Animated.View entering={FadeIn} style={[styles.progress, { backgroundColor: t.card, borderColor: t.hairline }]} accessibilityLiveRegion="polite">
            {PHASES.map((p, i) => {
              const at = PHASES.findIndex(x => x.key === phase)
              const state = i < at ? 'done' : i === at ? 'now' : 'todo'
              return (
                <View key={p.key} style={styles.phase}>
                  {state === 'done' ? (
                    <Icon name="checkmark-circle" size={22} color={t.success} />
                  ) : state === 'now' ? (
                    <ActivityIndicator color={t.primary} />
                  ) : (
                    <Icon name="ellipse-outline" size={22} color={t.muted} />
                  )}
                  <Text tone={state === 'todo' ? 'muted' : 'ink'} weight={state === 'now' ? 'semibold' : undefined}>
                    {p.label}
                    {p.key === 'download' && state === 'now' && status?.sizeBytes ? ` (${fmtBytes(status.sizeBytes)})` : ''}
                  </Text>
                </View>
              )
            })}
            <Text variant="small" tone="muted">
              Keep Iris open. New messages keep arriving and are kept.
            </Text>
          </Animated.View>
        ) : (
          <View style={{ gap: 16 }}>
            <Field
              label="Recovery key"
              value={key}
              onChangeText={v => {
                setKey(v)
                setError(null)
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              placeholder="XXXX XXXX XXXX …"
              multiline
              state={error ? 'error' : 'idle'}
              hint={error ?? '52 letters and digits, spaces optional'}
            />
            <Button
              title="Paste"
              variant="secondary"
              icon="clipboard"
              small
              style={{ alignSelf: 'flex-start' }}
              onPress={() => void Clipboard.getStringAsync().then(v => v && setKey(v.trim()))}
            />
            <Button title="Restore" icon="cloud-download" disabled={key.replace(/[\s-]/g, '').length < 52} onPress={restore} />
            <Button title="Skip" variant="ghost" onPress={skip} />
          </View>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 28, flexGrow: 1, justifyContent: 'center' },
  hero: { alignItems: 'center', gap: 10 },
  badge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  progress: { gap: 16, padding: 20, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  phase: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 },
})

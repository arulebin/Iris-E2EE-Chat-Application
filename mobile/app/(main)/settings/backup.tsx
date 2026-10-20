import { useState } from 'react'
import { Alert, View } from 'react-native'
import { useBackup, useServices } from '@/state/hooks'
import type { BackupFrequency } from '@/state/services'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Sheet } from '@/ui/components/Sheet'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { FrequencyPicker, RecoveryKeyView, fmtBackupTime, fmtBytes } from '@/ui/components/backup'

export default function Backup() {
  const q = useBackup()
  const { backup } = useServices()
  const toast = useToast()
  const [busy, setBusy] = useState<null | 'enable' | 'now' | 'restore' | 'off'>(null)
  const [key, setKey] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreKey, setRestoreKey] = useState('')
  const s = q.data

  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      toast.show((e as Error).message || 'Something went wrong', 'error')
    } finally {
      setBusy(null)
    }
  }

  const turnOn = () => {
    const go = () => run('enable', async () => setKey(await backup.enable('daily')))
    if (s?.serverBackup) {
      Alert.alert(
        'Replace the existing backup?',
        'A backup made with another recovery key is on the server. Turning backups on here replaces it with this phone\'s chats. To keep those messages, restore that backup first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Restore first', onPress: () => setRestoreOpen(true) },
          { text: 'Replace', style: 'destructive', onPress: go },
        ],
      )
    } else go()
  }

  const turnOff = () =>
    Alert.alert('Turn off backups?', 'The backup is deleted from the server. If you lose or reinstall this phone, your messages cannot be recovered.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: () => void run('off', () => backup.disable()) },
    ])

  const last = s?.lastBackupAt ? `${fmtBackupTime(s.lastBackupAt)}${s.sizeBytes ? ` · ${fmtBytes(s.sizeBytes)}` : ''}` : 'Never'

  return (
    <Page title="Chat backup">
      <View style={{ padding: 20, gap: 8 }}>
        <Text tone="muted">
          Your messages are stored only on this phone. Back them up to Iris&apos;s server, end-to-end encrypted with a recovery key only you have, so you can restore them if you change or reinstall your phone. Photos and videos are included while they are still on the server.
        </Text>
      </View>

      <Section title="Last backup">
        <ListItem icon="time" title={last} subtitle={s?.enabled ? 'Backed up from this phone' : s?.serverBackup ? 'Backup on the server, not updated from this phone' : 'No backup yet'} />
      </Section>

      {s?.enabled ? (
        <>
          <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            <Button
              title="Back up now"
              icon="cloud-upload"
              loading={busy === 'now'}
              disabled={!!busy}
              onPress={() =>
                run('now', async () => {
                  await backup.backupNow()
                  toast.show('Backup complete', 'success')
                })
              }
            />
          </View>
          <Section title="Back up automatically">
            <FrequencyPicker
              value={s.frequency}
              options={['daily', 'weekly', 'manual']}
              disabled={!!busy}
              onChange={f => void run('now', () => backup.setFrequency(f as BackupFrequency))}
            />
          </Section>
          <Section>
            <ListItem icon="cloud-offline" title="Turn off backups" destructive disabled={!!busy} onPress={turnOff} />
          </Section>
        </>
      ) : (
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <Button title="Turn on backups" icon="cloud-upload" loading={busy === 'enable'} disabled={!s || !!busy} onPress={turnOn} />
          {busy === 'enable' ? (
            <Text variant="small" tone="muted" align="center">
              Encrypting and uploading your first backup…
            </Text>
          ) : null}
        </View>
      )}

      {s?.serverBackup ? (
        <View style={{ padding: 20 }}>
          <Button title="Restore from backup" variant="secondary" icon="cloud-download" disabled={!!busy} onPress={() => setRestoreOpen(true)} />
        </View>
      ) : null}

      <Sheet visible={!!key} onClose={() => setKey(null)} title="Your recovery key">
        <View style={{ padding: 20 }}>
          {key ? <RecoveryKeyView recoveryKey={key} onDone={() => setKey(null)} /> : null}
        </View>
      </Sheet>

      <Sheet visible={restoreOpen} onClose={() => (busy ? undefined : setRestoreOpen(false))} title="Restore messages">
        <View style={{ padding: 20, gap: 14 }}>
          <Text tone="muted" variant="small">
            Messages already on this phone are kept; the backup adds what is missing.
          </Text>
          <Field label="Recovery key" value={restoreKey} onChangeText={setRestoreKey} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX XXXX XXXX …" />
          <Button
            title="Restore"
            loading={busy === 'restore'}
            disabled={restoreKey.replace(/[\s-]/g, '').length < 52 || !!busy}
            onPress={() =>
              run('restore', async () => {
                const n = await backup.restore(restoreKey)
                setRestoreOpen(false)
                setRestoreKey('')
                toast.show(n ? `Restored ${n} messages` : 'Your chats are up to date', 'success')
              })
            }
          />
        </View>
      </Sheet>
    </Page>
  )
}

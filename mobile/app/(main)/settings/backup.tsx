import { useState } from 'react'
import { View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useBackup, useServices } from '@/state/hooks'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Sheet } from '@/ui/components/Sheet'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'

function fmtSize(b?: number) {
  if (!b) return ''
  return b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.round(b / 1000)} KB`
}

export default function Backup() {
  const q = useBackup()
  const { backup } = useServices()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreKey, setRestoreKey] = useState('')
  const s = q.data

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.show((e as Error).message || 'Something went wrong', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page title="Backup">
      <View style={{ padding: 20 }}>
        <Text tone="muted">
          Messages are end-to-end encrypted with forward secrecy, so a new device starts empty. An encrypted backup, locked with a recovery key only you have, lets you bring your history along.
        </Text>
      </View>
      <Section title="Encrypted backup">
        <ListItem
          icon="cloud-upload"
          title="Automatic backup"
          subtitle="Daily, in the background"
          value={s?.enabled ?? false}
          disabled={!s || busy}
          onValueChange={v =>
            run(async () => {
              if (v) setKey(await backup.enable())
              else await backup.disable()
            })
          }
        />
        <ListItem icon="time" title="Last backup" subtitle={s?.lastBackupAt ? `${new Date(s.lastBackupAt).toLocaleString()}${s.sizeBytes ? ` (${fmtSize(s.sizeBytes)})` : ''}` : 'Never'} />
      </Section>
      <View style={{ padding: 20, gap: 10 }}>
        <Button
          title="Back up now"
          icon="cloud-upload"
          loading={busy}
          disabled={!s?.enabled}
          onPress={() =>
            run(async () => {
              await backup.backupNow()
              toast.show('Backup complete', 'success')
            })
          }
        />
        <Button title="Restore from backup" variant="secondary" icon="cloud-download" onPress={() => setRestoreOpen(true)} />
      </View>

      <Sheet visible={!!key} onClose={() => setKey(null)} title="Your recovery key">
        <View style={{ padding: 20, gap: 14 }}>
          <Text weight="bold" selectable style={{ letterSpacing: 1 }}>
            {key}
          </Text>
          <Text tone="muted" variant="small">
            Write this down and keep it somewhere safe. It is shown only once, and without it the backup cannot be opened, not even by Iris.
          </Text>
          <Button title="Copy" variant="secondary" icon="copy" onPress={() => Clipboard.setStringAsync(key ?? '').then(() => toast.show('Copied', 'success'))} />
          <Button title="I have saved it" onPress={() => setKey(null)} />
        </View>
      </Sheet>

      <Sheet visible={restoreOpen} onClose={() => setRestoreOpen(false)} title="Restore messages">
        <View style={{ padding: 20, gap: 14 }}>
          <Field label="Recovery key" value={restoreKey} onChangeText={setRestoreKey} autoCapitalize="characters" autoCorrect={false} placeholder="XXXX XXXX XXXX ..." />
          <Button
            title="Restore"
            loading={busy}
            disabled={restoreKey.trim().length < 8}
            onPress={() =>
              run(async () => {
                const n = await backup.restore(restoreKey)
                setRestoreOpen(false)
                setRestoreKey('')
                toast.show(`Restored ${n} messages`, 'success')
              })
            }
          />
        </View>
      </Sheet>
    </Page>
  )
}

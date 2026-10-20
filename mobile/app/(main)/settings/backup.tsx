import { useState } from 'react'
import { View } from 'react-native'
import { useBackup, useServices } from '@/state/hooks'
import { Button } from '@/ui/components/Button'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
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
  const s = q.data

  return (
    <Page title="Backup">
      <View style={{ padding: 20 }}>
        <Text tone="muted">Back up your encrypted message history and keys. Backups are encrypted with a key derived from your password, so only you can restore them.</Text>
      </View>
      <Section title="Encrypted backup">
        <ListItem icon="cloud-upload" title="Automatic backup" subtitle="Daily, on Wi-Fi" value={s?.enabled ?? false} onValueChange={v => backup.setEnabled(v)} disabled={!s} />
        <ListItem icon="time" title="Last backup" subtitle={s?.lastBackupAt ? `${new Date(s.lastBackupAt).toLocaleString()} (${fmtSize(s.sizeBytes)})` : 'Never'} />
      </Section>
      <View style={{ padding: 20, gap: 10 }}>
        <Button
          title="Back up now"
          icon="cloud-upload"
          loading={busy}
          onPress={async () => {
            setBusy(true)
            await backup.backupNow()
            setBusy(false)
            toast.show('Backup complete', 'success')
          }}
        />
        <Button title="Restore from backup" variant="secondary" icon="cloud-download" onPress={() => toast.show('Restore is available when signing in on a new device')} />
      </View>
    </Page>
  )
}

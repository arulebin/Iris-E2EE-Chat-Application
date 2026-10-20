import { Alert } from 'react-native'
import { useDevices, useServices } from '@/state/hooks'
import type { DeviceInfo } from '@/state/services'
import { Button } from '@/ui/components/Button'
import type { IconName } from '@/ui/components/Icon'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { fmtBackupTime } from '@/ui/components/backup'

const ICON: Record<DeviceInfo['platform'], IconName> = { android: 'logo-android', ios: 'logo-apple', web: 'globe-outline' }

export default function Devices() {
  const q = useDevices()
  const { devices } = useServices()
  const toast = useToast()
  const rows = [...(q.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActive - a.lastActive)
  const current = rows.filter(d => d.current)
  const others = rows.filter(d => !d.current)

  const remove = (d: DeviceInfo) =>
    Alert.alert(`Remove ${d.name}?`, 'It is signed out and stops receiving messages. Messages already on it stay there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await devices.revoke(d.id)
            toast.show('Device removed', 'success')
          } catch (e) {
            toast.show((e as Error)?.message || "Couldn't remove the device", 'error')
          }
        },
      },
    ])

  return (
    <Page title="Linked devices">
      {current.length ? (
        <Section title="This device">
          {current.map(d => (
            <ListItem key={d.id} icon={ICON[d.platform]} title={d.name} subtitle="This device · active now" />
          ))}
        </Section>
      ) : null}
      <Section
        title="Other devices"
        footer="Every device you sign in on gets its own copy of each message. Devices not used for 30 days are removed automatically, and reinstalling Iris on a phone replaces its old entry."
      >
        {others.length ? (
          others.map(d => (
            <ListItem
              key={d.id}
              icon={ICON[d.platform]}
              title={d.name}
              subtitle={d.lastActive ? `Last active ${fmtBackupTime(d.lastActive)}` : 'Never active'}
              right={<Button small variant="danger" title="Remove" onPress={() => remove(d)} />}
            />
          ))
        ) : (
          <Text tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
            {q.data ? 'No other devices' : q.error ? "Couldn't load your devices" : 'Loading…'}
          </Text>
        )}
      </Section>
    </Page>
  )
}

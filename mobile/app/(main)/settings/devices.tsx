import { Alert } from 'react-native'
import { useDevices, useServices } from '@/state/hooks'
import type { DeviceInfo } from '@/state/services'
import { Button } from '@/ui/components/Button'
import type { IconName } from '@/ui/components/Icon'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { useToast } from '@/ui/components/Toast'
import { listTime } from '@/ui/lib/timeline'

const ICON: Record<DeviceInfo['platform'], IconName> = { android: 'logo-android', ios: 'logo-apple', web: 'globe-outline' }

export default function Devices() {
  const q = useDevices()
  const { devices } = useServices()
  const toast = useToast()
  const rows = q.data ?? []
  return (
    <Page title="Linked devices">
      <Section title="Signed in on" footer="Revoking a device signs it out and stops it from receiving new messages.">
        {rows.map(d => (
          <ListItem
            key={d.id}
            icon={ICON[d.platform]}
            title={d.name}
            subtitle={d.current ? 'This device' : `Active ${listTime(d.lastActive)}`}
            right={
              d.current ? undefined : (
                <Button
                  small
                  variant="danger"
                  title="Revoke"
                  onPress={() =>
                    Alert.alert(`Revoke ${d.name}?`, 'It will be signed out.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Revoke',
                        style: 'destructive',
                        onPress: async () => {
                          await devices.revoke(d.id)
                          toast.show('Device revoked', 'success')
                        },
                      },
                    ])
                  }
                />
              )
            }
          />
        ))}
      </Section>
    </Page>
  )
}

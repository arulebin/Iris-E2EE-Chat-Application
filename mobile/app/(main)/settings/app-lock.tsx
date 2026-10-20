import { View } from 'react-native'
import { useSettings } from '@/state/hooks'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'

/** App lock (off by default): a Keystore key that only unlocks after biometrics / device credential. */
export default function AppLock() {
  const { settings, update } = useSettings()
  const toast = useToast()
  return (
    <Page title="App lock">
      <View style={{ padding: 20 }}>
        <Text tone="muted">Require biometrics or your device passcode to open Iris. When enabled, your encryption keys are wrapped with a key that only unlocks after you authenticate.</Text>
      </View>
      <Section>
        <ListItem
          icon="finger-print"
          title="Unlock with biometrics"
          value={settings.appLock}
          onValueChange={async v => {
            const err = await update({ appLock: v })
            if (err) toast.show(err.message || 'Could not change app lock', 'error')
            else toast.show(v ? 'App lock on: Iris locks 20 seconds after you leave it' : 'App lock off', 'success')
          }}
        />
        <ListItem icon="timer" title="Lock after" subtitle="20 seconds in the background" disabled />
      </Section>
    </Page>
  )
}

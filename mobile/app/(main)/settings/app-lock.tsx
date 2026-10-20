import { View } from 'react-native'
import { useSettings } from '@/state/hooks'
import { ListItem, Section } from '@/ui/components/ListItem'
import { Page } from '@/ui/components/Page'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'

/** Placeholder: biometric/passkey lock lands with the platform adapter (expo-local-authentication + Keystore). */
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
          onValueChange={v => {
            update({ appLock: v })
            toast.show(v ? 'App lock enabled (preview)' : 'App lock disabled', 'success')
          }}
        />
        <ListItem icon="timer" title="Lock after" subtitle="Immediately (coming soon)" disabled />
      </Section>
    </Page>
  )
}

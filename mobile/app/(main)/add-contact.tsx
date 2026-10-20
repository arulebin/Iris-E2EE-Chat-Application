import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useServices } from '@/state/hooks'
import { ServiceError } from '@/state/services'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Header } from '@/ui/components/Header'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { isValidUsername, normalizeInviteCode } from '@/ui/lib/validation'

export default function AddContact() {
  const router = useRouter()
  const { contacts } = useServices()
  const toast = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = value.trim()
  const valid = !!normalizeInviteCode(trimmed) || isValidUsername(trimmed.replace(/^@/, ''))

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const c = await contacts.add(trimmed)
      haptic.success()
      toast.show(`Added ${c.displayName}`, 'success')
      router.back()
    } catch (e) {
      haptic.error()
      const code = e instanceof ServiceError ? e.code : 'network'
      setError(
        code === 'already-friends' ? 'You are already friends.' : code === 'not-found' ? 'No one found with that code.' : code === 'invalid-code' ? 'That is not a valid invite code or username.' : 'Something went wrong. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top']}>
      <Header title="Add with invite" onBack={() => router.back()} />
      <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text tone="muted">Enter your friend's invite code (XXXXX-XXXXX) or their username. You can find your own code in Settings, Privacy.</Text>
        <Field
          label="Invite code or username"
          placeholder="XXXXX-XXXXX"
          value={value}
          onChangeText={t => {
            setValue(t)
            setError(null)
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => valid && add()}
          state={error ? 'error' : 'idle'}
          hint={error ?? undefined}
        />
        <View style={{ gap: 10 }}>
          <Button title="Add friend" onPress={add} loading={busy} disabled={!valid} />
          <Button title="Scan QR code" variant="secondary" icon="qr-code" onPress={() => toast.show('QR scanning arrives with the camera update')} />
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 20 },
})

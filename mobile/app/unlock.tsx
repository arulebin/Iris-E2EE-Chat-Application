import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { IrisMark } from '@/components/IrisMark'
import { useServices, useSession, useSettings } from '@/state/hooks'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { useTheme } from '@/ui/theme'

export default function Unlock() {
  const t = useTheme()
  const { auth } = useServices()
  const session = useSession()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shake = useSharedValue(0)
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))
  const { settings } = useSettings()
  const canBio = settings.appLock && !!auth.unlockWithBiometrics
  const prompted = useRef(false)

  async function bio() {
    if (!auth.unlockWithBiometrics || busy) return
    try {
      await auth.unlockWithBiometrics()
      haptic.success()
    } catch (e) {
      // Cancelled prompt, or the keys need the password (new device / revoked): fall back to the field.
      const msg = (e as Error)?.message ?? ''
      if (msg && !/cancel/i.test(msg)) toast.show(msg, 'info')
    }
  }

  // Offer the system prompt straight away when app lock is on.
  useEffect(() => {
    if (canBio && !prompted.current) {
      prompted.current = true
      void bio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBio])

  async function submit() {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await auth.unlock(password)
      haptic.success()
    } catch {
      haptic.error()
      shake.value = withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 80 }), withTiming(-6, { duration: 70 }), withTiming(0, { duration: 50 }))
      setError('Wrong password.')
      setBusy(false)
    }
  }

  return (
    <Screen>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.brand}>
          <IrisMark size={88} dark={t.isDark} />
          <Text variant="h1">Iris is locked</Text>
          <Text tone="muted" align="center">
            {session ? `Enter the password for ${session.username} to unlock.` : 'Enter your password to unlock.'}
          </Text>
        </Animated.View>
        <Animated.View style={shakeStyle}>
          <Field
            label="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secure
            autoFocus
            autoCapitalize="none"
            returnKeyType="go"
            onSubmitEditing={submit}
            state={error ? 'error' : 'idle'}
            hint={error ?? undefined}
          />
        </Animated.View>
        <View style={{ gap: 12 }}>
          <Button title="Unlock" onPress={submit} loading={busy} disabled={!password} />
          {canBio ? <Button title="Use biometrics or screen lock" variant="secondary" icon="finger-print" onPress={bio} /> : null}
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 28, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: 8 },
})

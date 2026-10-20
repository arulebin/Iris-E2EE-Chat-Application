import { useRouter } from 'expo-router'
import { useRef, useState, type ComponentRef } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { IrisMark } from '@/components/IrisMark'
import { useServices } from '@/state/hooks'
import { AuthError } from '@/state/services'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Header } from '@/ui/components/Header'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { haptic } from '@/ui/lib/haptics'
import { useTheme } from '@/ui/theme'

export default function Login() {
  const t = useTheme()
  const router = useRouter()
  const { auth } = useServices()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null)
  const shake = useSharedValue(0)
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }))

  const ready = username.trim().length > 0 && password.length > 0

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await auth.login(username.trim(), password)
      haptic.success()
      // The root navigator swaps to the main stack when the session appears.
    } catch (e) {
      haptic.error()
      shake.value = withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 80 }), withTiming(-6, { duration: 70 }), withTiming(0, { duration: 50 }))
      setError(e instanceof AuthError && e.code === 'network' ? 'Cannot reach the server. Check your connection.' : 'Wrong username or password.')
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top']}>
      <Header title="" onBack={() => router.back()} />
      <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.brand}>
          <IrisMark size={72} dark={t.isDark} />
          <Text variant="h1">Welcome back</Text>
          <Text tone="muted" align="center">
            Sign in to unlock your messages on this device.
          </Text>
        </Animated.View>
        <Animated.View style={[{ gap: 16 }, shakeStyle]}>
          <Field
            label="Username"
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => pwRef.current?.focus()}
            blurOnSubmit={false}
          />
          <Field
            ref={pwRef}
            label="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            state={error ? 'error' : 'idle'}
            hint={error ?? undefined}
          />
        </Animated.View>
        <View style={{ gap: 12 }}>
          <Button title="Sign in" onPress={submit} loading={busy} disabled={!ready} />
          <Button title="Create a new account" variant="ghost" onPress={() => router.replace('/signup')} />
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 28, flexGrow: 1 },
  brand: { alignItems: 'center', gap: 8 },
})

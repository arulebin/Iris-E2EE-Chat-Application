import { useRouter } from 'expo-router'
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useServices } from '@/state/hooks'
import { AuthError } from '@/state/services'
import { Button } from '@/ui/components/Button'
import { Field } from '@/ui/components/Field'
import { Header } from '@/ui/components/Header'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { haptic } from '@/ui/lib/haptics'
import { STRENGTH_LABELS, passwordStrength, usernameIssue, usernameMessage } from '@/ui/lib/validation'
import { useTheme } from '@/ui/theme'

type Avail = 'idle' | 'checking' | 'free' | 'taken'

function StrengthBar({ level }: { level: number }) {
  const t = useTheme()
  const color = level <= 1 ? t.danger : level === 2 ? t.warning : t.success
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4].map(i => (
          <Segment key={i} on={i <= level} color={color} off={t.hairline} />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {level ? STRENGTH_LABELS[level] : 'Use at least 8 characters. A passphrase works best.'}
      </Text>
    </View>
  )
}

function Segment({ on, color, off }: { on: boolean; color: string; off: string }) {
  const style = useAnimatedStyle(() => ({ backgroundColor: withTiming(on ? color : off, { duration: 200 }) }), [on, color, off])
  return <Animated.View style={[{ flex: 1, height: 4, borderRadius: 2 }, style]} />
}

export default function Signup() {
  const router = useRouter()
  const { auth } = useServices()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [avail, setAvail] = useState<Avail>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null)
  const cfRef = useRef<ComponentRef<typeof TextInput>>(null)

  const issue = usernameIssue(username)
  const strength = passwordStrength(password)
  const mismatch = confirm.length > 0 && confirm !== password

  // Debounced availability check once the username is syntactically valid.
  useEffect(() => {
    if (issue) return setAvail('idle')
    setAvail('checking')
    let live = true
    const id = setTimeout(() => {
      auth
        .isUsernameAvailable(username)
        .then(free => live && setAvail(free ? 'free' : 'taken'))
        .catch(() => live && setAvail('idle'))
    }, 350)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [username, issue, auth])

  const nameState = username.length === 0 ? 'idle' : issue || avail === 'taken' ? 'error' : avail === 'free' ? 'ok' : 'idle'
  const nameHint = username.length === 0 ? usernameMessage('empty') : issue ? usernameMessage(issue) : avail === 'taken' ? 'That username is taken.' : avail === 'checking' ? 'Checking availability…' : avail === 'free' ? 'Username is available.' : 'Looks good.'
  const ready = !issue && avail === 'free' && strength >= 2 && password === confirm && !busy

  async function submit() {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await auth.signup(username, password)
      haptic.success()
    } catch (e) {
      haptic.error()
      setError(e instanceof AuthError && e.code === 'username-taken' ? 'That username was just taken.' : 'Could not create the account. Try again.')
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top']}>
      <Header title="Create account" onBack={() => router.back()} />
      <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Text tone="muted">Pick a username. Your password protects the encryption keys stored on this device, so Iris cannot recover it for you.</Text>
        <Field
          label="Username"
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
          autoComplete="username-new"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => pwRef.current?.focus()}
          blurOnSubmit={false}
          state={nameState}
          hint={nameHint}
          trailing={nameState === 'ok' ? <Icon name="checkmark-circle" size={20} color="#16a34a" /> : undefined}
        />
        <View style={{ gap: 12 }}>
          <Field
            ref={pwRef}
            label="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => cfRef.current?.focus()}
            blurOnSubmit={false}
          />
          <StrengthBar level={strength} />
        </View>
        <Field
          ref={cfRef}
          label="Confirm password"
          placeholder="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          secure
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={submit}
          state={mismatch ? 'error' : 'idle'}
          hint={mismatch ? 'Passwords do not match.' : error ?? undefined}
        />
        <Button title="Create account" onPress={submit} loading={busy} disabled={!ready} />
        <Text variant="caption" tone="muted" align="center">
          By continuing you agree this software is provided as is under the GPL-3.0 license.
        </Text>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 20, flexGrow: 1 },
})

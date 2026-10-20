import { useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IrisMark } from '@/components/IrisMark'
import { useTheme } from '@/theme'

// Placeholder auth screen: no network yet. Real flow lands in phase 3 (see docs/mobile-architecture.md).
export default function AuthScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const ready = username.trim().length > 1 && password.length > 5

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
    >
      <Animated.View entering={FadeIn.duration(500)} style={styles.brand}>
        <IrisMark size={120} dark={t.isDark} />
        <Text style={[styles.title, { color: t.ink }]}>Iris</Text>
        <Text style={[styles.tag, { color: t.muted }]}>Private by design. End-to-end encrypted.</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(150).springify()} style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor={t.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: t.ink, borderColor: t.hairline }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={t.muted}
          secureTextEntry
          style={[styles.input, { color: t.ink, borderColor: t.hairline }]}
        />
        <Pressable
          disabled={!ready}
          onPress={() => router.replace('/chats')}
          style={({ pressed }) => [styles.button, { backgroundColor: t.primary, opacity: !ready ? 0.45 : pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: t.onPrimary }]}>{mode === 'login' ? 'Sign in' : 'Create account'}</Text>
        </Pressable>
        <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} hitSlop={12}>
          <Text style={[styles.switch, { color: t.primary }]}>
            {mode === 'login' ? 'New to Iris? Create an account' : 'Have an account? Sign in'}
          </Text>
        </Pressable>
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, justifyContent: 'space-between' },
  brand: { alignItems: 'center', gap: 6 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  tag: { fontSize: 15 },
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 14 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 16 },
  button: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  switch: { textAlign: 'center', fontSize: 14, fontWeight: '600' },
})

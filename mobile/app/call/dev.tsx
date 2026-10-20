import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  CallOverlay, configureCalls, getCallEngine, handleIncomingCallPush, startCall, useCall,
} from '@/calls'

/**
 * Developer harness for the calls UI (`iris://call/dev`). Not linked from the app.
 * It configures the calls module with a no-op transport so every screen can be
 * exercised without a backend: simulate a push-announced incoming call, dial
 * (the offer goes nowhere, so it rings until the 45s timeout) and drive the
 * mini-window / pill / ended screens.
 */
let configured = false
function ensureConfigured() {
  if (configured) return
  configured = true
  configureCalls({
    apiBase: process.env.EXPO_PUBLIC_API_BASE ?? 'http://10.0.2.2:8080',
    getToken: () => null,
    log: (...a) => console.log(...a),
  })
}

export default function CallDev() {
  const insets = useSafeAreaInsets()
  const [ready, setReady] = useState(false)
  const [peer, setPeer] = useState('alice')
  useEffect(() => { ensureConfigured(); setReady(true) }, [])
  if (!ready) return null
  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <Harness peer={peer} setPeer={setPeer} />
      <CallOverlay
        profileOf={(u) => ({ name: u[0]?.toUpperCase() + u.slice(1) })}
        onQuickReply={(p, t) => console.log('quick reply', p, t)}
      />
    </View>
  )
}

function Harness({ peer, setPeer }: { peer: string; setPeer: (s: string) => void }) {
  const call = useCall()
  const btn = (label: string, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} style={styles.btn}><Text style={styles.btnText}>{label}</Text></Pressable>
  )
  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Text style={styles.h}>Call UI harness · state: {call.state.kind}</Text>
      <TextInput value={peer} onChangeText={setPeer} autoCapitalize="none" style={styles.input} />
      {btn('Simulate incoming voice (push, no caller)', () => handleIncomingCallPush({ type: 'incoming-call', callId: `dev-${Date.now()}`, mode: 'audio' }))}
      {btn('Simulate incoming video from peer', () => handleIncomingCallPush({ type: 'incoming-call', callId: `dev-${Date.now()}`, from: peer, mode: 'video' }))}
      {btn('Dial voice', () => void startCall(peer, 'audio'))}
      {btn('Dial video', () => void startCall(peer, 'video'))}
      {btn('Minimise', () => getCallEngine().setMinimized(true))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  h: { fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  btn: { backgroundColor: '#5b5bd6', padding: 12, borderRadius: 10 },
  btnText: { color: '#fff' },
})

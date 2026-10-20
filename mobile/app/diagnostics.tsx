import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { runConformance, summarize, type CaseResult } from '@iris/crypto-conformance'
import { nativeCryptoProvider } from '@/crypto/provider'
import { useTheme } from '@/theme'

/**
 * Runs the shared crypto conformance suite (known-answer tests) against
 * react-native-quick-crypto on THIS device, with timings. The 600k PBKDF2 case
 * shows whether login key derivation is native-speed.
 */
export default function Diagnostics() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [results, setResults] = useState<CaseResult[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setResults([])
    const acc: CaseResult[] = []
    try {
      await runConformance(nativeCryptoProvider(), {
        now: () => performance.now(),
        onResult: r => {
          acc.push(r)
          setResults([...acc])
        },
      })
    } finally {
      setRunning(false)
    }
  }
  const s = summarize(results)

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={{ color: t.primary, fontWeight: '700' }}>Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.ink }]}>Crypto diagnostics</Text>
      </View>
      <Pressable disabled={running} onPress={run} style={[styles.button, { backgroundColor: t.primary, opacity: running ? 0.5 : 1 }]}>
        <Text style={styles.buttonText}>{running ? 'Running...' : 'Run conformance suite'}</Text>
      </Pressable>
      <Text style={{ color: t.muted, marginVertical: 8 }}>
        {results.length ? `${s.pass} passed, ${s.fail} failed, ${s.skip} skipped` : 'Provider: react-native-quick-crypto'}
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {results.map((r, i) => (
          <View key={i} style={[styles.row, { borderColor: t.hairline }]}>
            <Text style={{ color: r.status === 'pass' ? t.online : r.status === 'fail' ? t.danger : t.muted, fontWeight: '800', width: 44 }}>
              {r.status.toUpperCase()}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.ink }}>{r.group}: {r.name}</Text>
              {r.error ? <Text style={{ color: t.danger, fontSize: 11 }}>{r.error}</Text> : null}
            </View>
            <Text style={{ color: t.muted }}>{Math.round(r.ms)} ms</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { gap: 8, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '800' },
  button: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
})

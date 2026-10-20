import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { nativeCryptoProvider } from '@/crypto/provider'
import { runBench, type BenchRow } from '@/platform/bench'
import { runPlatformSmoke } from '@/platform/smoke'
import { useTheme } from '@/theme'

/**
 * Phase 1 gate benchmark screen. Deep link: iris://bench?autorun=1 runs immediately and logs
 * every row to logcat as "IRIS_BENCH {json}" (adb logcat -s ReactNativeJS:V).
 */
export default function Bench() {
  const t = useTheme()
  const { autorun } = useLocalSearchParams<{ autorun?: string }>()
  const [rows, setRows] = useState<BenchRow[]>([])
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    if (autorun !== '1') return
    let alive = true
    setStatus('running')
    runBench(nativeCryptoProvider(), {
      log: r => {
        console.log('IRIS_BENCH ' + JSON.stringify(r))
        if (alive) setRows(prev => [...prev, r])
      },
    })
      .then(() =>
        runPlatformSmoke((name, ok, detail) => {
          console.log('IRIS_SMOKE ' + JSON.stringify({ name, ok, detail }))
          if (alive) setRows(prev => [...prev, { name: 'smoke: ' + name, ms: 0, pass: ok, note: detail }])
        }),
      )
      .then(() => {
        console.log('IRIS_BENCH_DONE')
        if (alive) setStatus('done')
      })
      .catch(e => {
        console.log('IRIS_BENCH_ERROR ' + String(e?.stack ?? e))
        if (alive) setStatus('error: ' + String(e))
      })
    return () => {
      alive = false
    }
  }, [autorun])

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 48, paddingHorizontal: 16 }}>
      <Text style={{ color: t.ink, fontSize: 22, fontWeight: '800' }}>Crypto benchmark</Text>
      <Text style={{ color: t.muted, marginBottom: 8 }}>{status}</Text>
      <ScrollView>
        {rows.map((r, i) => (
          <Text key={i} style={{ color: r.pass === false ? t.danger : t.ink, marginVertical: 2 }}>
            {r.name}: {r.ms} ms{r.gate ? ` (gate ${r.gate})` : ''}
            {r.note ? ` ${r.note}` : ''}
          </Text>
        ))}
      </ScrollView>
    </View>
  )
}

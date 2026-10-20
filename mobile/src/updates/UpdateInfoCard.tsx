import * as Application from 'expo-application'
import * as Updates from 'expo-updates'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/theme'
import { distribution, useOtaUpdates } from './useUpdates'

/** Settings -> About block: running version, update id, channel, runtime version. */
export function UpdateInfoCard() {
  const t = useTheme()
  const ota = useOtaUpdates()
  const rows: [string, string][] = [
    ['Version', `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`],
    ['Update', Updates.isEnabled ? (ota.current.isEmbeddedLaunch ? 'Built-in bundle' : (ota.current.updateId ?? 'unknown')) : 'Disabled (dev build)'],
    ['Channel', Updates.channel ?? 'n/a'],
    ['Runtime', Updates.runtimeVersion ?? 'n/a'],
    ['Install', distribution() === 'play' ? 'Google Play' : 'Direct download'],
  ]
  if (ota.current.isEmergencyLaunch) rows.push(['Recovery', ota.current.emergencyLaunchReason ?? 'Fell back to built-in bundle'])
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.hairline }]}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={{ color: t.muted }}>{k}</Text>
          <Text style={{ color: t.ink, flexShrink: 1, textAlign: 'right' }} selectable>
            {v}
          </Text>
        </View>
      ))}
      <Pressable
        disabled={ota.checking || ota.downloading || !Updates.isEnabled}
        onPress={() => void ota.checkNow()}
        style={{ paddingTop: 8, opacity: ota.checking || ota.downloading || !Updates.isEnabled ? 0.5 : 1 }}
      >
        <Text style={{ color: t.primary, fontWeight: '700' }}>
          {ota.downloading ? 'Downloading...' : ota.checking ? 'Checking...' : ota.pending ? 'Update downloaded - restarts next launch' : 'Check for updates'}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
})

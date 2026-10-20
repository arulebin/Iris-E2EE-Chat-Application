import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafety, useServices } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { Header } from '@/ui/components/Header'
import { Icon } from '@/ui/components/Icon'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { groupSafetyDigits } from '@/ui/lib/validation'
import { fonts, radius, useTheme } from '@/ui/theme'
import { Platform } from 'react-native'

export default function SafetyNumber() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useSafety(id)
  const { safety } = useServices()
  const toast = useToast()
  const s = q.data
  const groups = s ? groupSafetyDigits(s.digits) : []

  async function toggle() {
    if (!s) return
    await safety.setVerified(s.contactId, !s.verified)
    if (!s.verified) {
      haptic.success()
      toast.show(`${s.contactName} marked as verified`, 'success')
    } else toast.show('Verification removed')
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Header title="Verify safety number" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {s ? (
          <Animated.View entering={FadeIn.duration(250)} style={{ gap: 22, alignItems: 'center' }}>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Avatar name={s.contactName} seed={s.contactId} size={64} />
              <Text variant="h2">{s.contactName}</Text>
              {s.verified ? (
                <View style={[styles.pill, { backgroundColor: t.primarySoft }]}>
                  <Icon name="shield-checkmark" size={16} color={t.success} />
                  <Text variant="caption" weight="bold" tone="success">
                    Verified
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.qr, { backgroundColor: '#fff' }]} accessibilityLabel="Safety number QR code">
              <QRCode value={s.qrPayload} size={190} color="#14181f" backgroundColor="#fff" />
            </View>

            <View style={[styles.grid, { backgroundColor: t.surface, borderColor: t.hairline }]} accessible accessibilityLabel={`Safety number: ${groups.join(' ')}`}>
              {groups.map((g, i) => (
                <Text key={i} style={styles.digits} color={t.ink}>
                  {g}
                </Text>
              ))}
            </View>

            <Text variant="small" tone="muted" align="center">
              To verify end-to-end encryption with {s.contactName}, compare this number with theirs in person, or scan their QR code. If both match, nobody is intercepting your messages.
            </Text>

            <View style={{ alignSelf: 'stretch', gap: 10 }}>
              <Button title={s.verified ? 'Remove verification' : 'Mark as verified'} icon={s.verified ? 'close-circle-outline' : 'shield-checkmark'} variant={s.verified ? 'secondary' : 'primary'} onPress={toggle} />
              <Button title="Scan their code" variant="secondary" icon="scan" onPress={() => toast.show('QR scanning arrives with the camera update')} />
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
  qr: { padding: 16, borderRadius: radius.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 10, rowGap: 10, alignSelf: 'stretch' },
  digits: { width: '25%', textAlign: 'center', fontSize: 18, letterSpacing: 1.5, fontFamily: Platform.OS === 'android' ? 'monospace' : fonts.semibold, fontVariant: ['tabular-nums'] },
})

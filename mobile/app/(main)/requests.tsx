import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated'
import { useRequests, useServices } from '@/state/hooks'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { Header } from '@/ui/components/Header'
import { Screen } from '@/ui/components/Screen'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { listTime } from '@/ui/lib/timeline'
import { useTheme } from '@/ui/theme'

export default function Requests() {
  const t = useTheme()
  const router = useRouter()
  const { contacts } = useServices()
  const toast = useToast()
  const q = useRequests()
  const rows = q.data ?? []
  return (
    <Screen edges={['top']}>
      <Header title="Friend requests" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {rows.length === 0 && !q.loading ? <EmptyState icon="mail-open-outline" title="No pending requests" body="When someone adds you, they will show up here." /> : null}
        {rows.map(r => (
          <Animated.View key={r.id} exiting={FadeOut.duration(160)} layout={LinearTransition} style={[styles.row, { borderBottomColor: t.hairline }]}>
            <Avatar name={r.from.displayName} seed={r.from.id} size={50} online={r.from.online} />
            <View style={{ flex: 1, gap: 10 }}>
              <View>
                <Text weight="bold">{r.from.displayName}</Text>
                <Text variant="caption" tone="muted">
                  @{r.from.username} - {listTime(r.createdAt)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  small
                  title="Accept"
                  style={{ flex: 1 }}
                  onPress={async () => {
                    await contacts.acceptRequest(r.id)
                    toast.show(`${r.from.displayName} is now your friend`, 'success')
                  }}
                />
                <Button small variant="secondary" title="Decline" style={{ flex: 1 }} onPress={() => contacts.declineRequest(r.id)} />
              </View>
            </View>
          </Animated.View>
        ))}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
})

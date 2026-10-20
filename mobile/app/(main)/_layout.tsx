import { Stack } from 'expo-router'
import { useTheme } from '@/ui/theme'

export default function MainLayout() {
  const t = useTheme()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new-chat" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="new-group" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="add-contact" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  )
}

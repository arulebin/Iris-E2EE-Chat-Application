import { Stack } from 'expo-router'
import { MAIN_STACK_SETTINGS } from '@/navigation/stack'
import { useTheme } from '@/ui/theme'

/** Chat list at the bottom of the stack, also under deep-linked screens (see MAIN_STACK_SETTINGS). */
export const unstable_settings = MAIN_STACK_SETTINGS

export default function MainLayout() {
  const t = useTheme()
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new-chat" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="new-group" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="add-contact" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="backup-setup" options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: false }} />
    </Stack>
  )
}

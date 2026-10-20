import { Stack } from 'expo-router'

/**
 * Media flow: camera, gallery picker, preview/editor and the full-screen viewer.
 * Recommended in the root layout: <Stack.Screen name="media" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
 * (use 'transparentModal' + 'fade' if you want the viewer's swipe-to-dismiss to reveal the chat underneath).
 */
export default function MediaLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: '#000' },
      }}
    >
      <Stack.Screen name="camera" options={{ animation: 'fade_from_bottom' }} />
      <Stack.Screen name="picker" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="preview" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="viewer" options={{ animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack>
  )
}

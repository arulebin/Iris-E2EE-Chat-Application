import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular'
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium'
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold'
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold'
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ServicesProvider, useSession, useSettings } from '@/state/hooks'
import { setHapticsEnabled } from '@/ui/lib/haptics'
import { ToastProvider } from '@/ui/components/Toast'
import { ThemeProvider, useTheme } from '@/ui/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})
import { UpdateBanner } from '@/updates'

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  })
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ServicesProvider>
            <Themed>{fontsLoaded ? <Navigator /> : null}</Themed>
          </ServicesProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Themed({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  useEffect(() => setHapticsEnabled(settings.haptics), [settings.haptics])
  return (
    <ThemeProvider mode={settings.theme}>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  )
}

function Navigator() {
  const t = useTheme()
  const session = useSession()

  useEffect(() => {
    if (session !== undefined) SplashScreen.hideAsync().catch(() => {})
  }, [session])

  if (session === undefined) return null
  const signedOut = session === null
  const locked = !!session?.locked

  return (
    <>
      <StatusBar style={t.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedOut && locked}>
          <Stack.Screen name="unlock" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedOut && !locked}>
          <Stack.Screen name="(main)" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Screen name="diagnostics" />
      </Stack>
    </>
  )
}

import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular'
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium'
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold'
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold'
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold'
import { useFonts } from 'expo-font'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { CallOverlay } from '@/calls'
import { ServicesProvider, useServices, useSession, useSettings } from '@/state/hooks'
import { peekRuntime } from '@/state/real'
import { setHapticsEnabled } from '@/ui/lib/haptics'
import { ToastProvider } from '@/ui/components/Toast'
import { ThemeProvider, useTheme } from '@/ui/theme'

import { UpdateBanner } from '@/updates'

SplashScreen.preventAutoHideAsync().catch(() => {})

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
  const services = useServices()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (session !== undefined) SplashScreen.hideAsync().catch(() => {})
  }, [session])

  const signedOut = session === null
  const locked = !!session?.locked

  // Protected groups hide screens but do not move the user: send them to the side they belong on
  // (cold start at "/" while signed out has no matching screen otherwise).
  const inAuth = segments[0] === '(auth)'
  const atUnlock = segments[0] === 'unlock'
  useEffect(() => {
    if (session === undefined) return
    if (signedOut && !inAuth) router.replace('/welcome')
    else if (!signedOut && locked && !atUnlock) router.replace('/unlock')
    else if (!signedOut && !locked && (inAuth || atUnlock)) router.replace('/')
  }, [session, signedOut, locked, inAuth, atUnlock, router])

  if (session === undefined) return null

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
      <UpdateBanner />
      {!signedOut ? (
        // Above the navigator, out of the layout flow; touch-transparent until a call UI is shown.
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <CallOverlay
            profileOf={u => ({ name: peekRuntime()?.nameOf(u) ?? u })}
            onQuickReply={(peer, text) => void services.chats.send(peer, text).catch(() => {})}
          />
        </View>
      ) : null}
    </>
  )
}

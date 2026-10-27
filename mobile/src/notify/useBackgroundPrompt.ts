import { useEffect } from 'react'
import { Alert } from 'react-native'
import { createMMKV } from 'react-native-mmkv'
import { peekRuntime } from '@/state/real'
import { backgroundPromptNeeded } from './backgroundRules'
import { IrisNotify } from './native'

const store = createMMKV({ id: 'iris-prefs' })
const ASKED_KEY = 'notify.backgroundPromptAsked'

/**
 * Once, on ROMs that block push delivery to apps without "Autostart" / "No restrictions" (Xiaomi, OPPO, vivo,
 * Huawei…; rules in backgroundRules.ts), explain why and open those settings. Without them such ROMs drop
 * message pushes once Iris is swiped away (and sometimes while it sits in recents).
 */
export function useBackgroundDeliveryPrompt(notificationsOn: boolean): void {
  useEffect(() => {
    let status = null
    try {
      status = IrisNotify?.backgroundStatus?.() ?? null
    } catch { /* older binary */ }
    if (!backgroundPromptNeeded({ status, notificationsOn, alreadyAsked: store.getBoolean(ASKED_KEY) ?? false })) return
    const t = setTimeout(() => {
      store.set(ASKED_KEY, true)
      Alert.alert(
        'Get messages in the background',
        'Your phone stops apps from receiving messages while closed. Allow Iris to start automatically and to run in the background (battery: No restrictions) so new messages always notify you.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open settings',
            onPress: () => {
              peekRuntime()?.suppressLock()
              try {
                IrisNotify?.openBackgroundSettings?.()
              } catch { /* nothing to open */ }
            },
          },
        ],
      )
    }, 1500) // after the chat list has settled
    return () => clearTimeout(t)
  }, [notificationsOn])
}

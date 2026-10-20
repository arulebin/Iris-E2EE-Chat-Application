import { requireOptionalNativeModule } from 'expo-modules-core'
import type { ConversationNotification } from './format'

/** Shape of com.iris.notify.IrisNotifyModule (modules/iris-calls/android). Android only. */
export interface IrisNotifyNative {
  readonly version: number
  showConversation(json: string): void
  cancelConversation(chatId: string): void
  cancelAll(): void
  showGeneric(kind: 'message' | 'request'): void
  cancelGeneric(): void
  showSocial(title: string, body: string, path: string): void
  /** The push with this id was handled by JS (no native generic fallback needed). */
  handled(pushId: string): void
}

/** Null on iOS / web / older binaries. Its presence means this build decrypts data-only message pushes. */
export const IrisNotify: IrisNotifyNative | null = requireOptionalNativeModule<IrisNotifyNative>('IrisNotify')

/** The thin, never-throwing facade the runtime uses. */
export const notifier = {
  supported: IrisNotify != null,
  showConversation(n: ConversationNotification) {
    try {
      IrisNotify?.showConversation(JSON.stringify(n))
    } catch (e) {
      console.warn('[notify] show failed', e)
    }
  },
  cancel(chatId: string) {
    try {
      IrisNotify?.cancelConversation(chatId)
    } catch { /* nothing to cancel */ }
  },
  cancelAll() {
    try {
      IrisNotify?.cancelAll()
    } catch { /* ignore */ }
  },
  generic(kind: 'message' | 'request' = 'message') {
    try {
      IrisNotify?.showGeneric(kind)
    } catch { /* ignore */ }
  },
  cancelGeneric() {
    try {
      IrisNotify?.cancelGeneric()
    } catch { /* ignore */ }
  },
  social(title: string, body: string, path: string) {
    try {
      IrisNotify?.showSocial(title, body, path)
    } catch { /* ignore */ }
  },
  handled(pushId: string | undefined) {
    if (!pushId) return
    try {
      IrisNotify?.handled(pushId)
    } catch { /* ignore */ }
  },
}

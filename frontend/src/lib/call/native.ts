import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Android call integration (CallNativePlugin.java): audio routing between the
// earpiece and the loudspeaker, and system picture-in-picture while a video call
// is running in the background. On the web these are no-ops / unsupported.

type CallNativePlugin = {
  startAudio(opts: { speaker: boolean }): Promise<void>
  setSpeaker(opts: { on: boolean }): Promise<void>
  stopAudio(): Promise<void>
  setPip(opts: { enabled: boolean; width?: number; height?: number }): Promise<void>
  addListener(event: 'pipChange', cb: (e: { active: boolean }) => void): Promise<PluginListenerHandle>
}

const CallNative = registerPlugin<CallNativePlugin>('CallNative')

export const nativeCallSupported = (): boolean => Capacitor.isNativePlatform()

const warn = (what: string) => (err: unknown) => console.warn(`[call-native] ${what}`, err)

/** Enter communication audio mode; voice calls start on the earpiece, video on the speaker. */
export function startCallAudio(speaker: boolean): void {
  if (nativeCallSupported()) CallNative.startAudio({ speaker }).catch(warn('startAudio'))
}

export function setCallSpeaker(on: boolean): void {
  if (nativeCallSupported()) CallNative.setSpeaker({ on }).catch(warn('setSpeaker'))
}

export function stopCallAudio(): void {
  if (nativeCallSupported()) CallNative.stopAudio().catch(warn('stopAudio'))
}

/** Allow (or stop) auto-entering system PiP when the user leaves the app mid video call. */
export function setCallPip(enabled: boolean, aspect?: { width: number; height: number }): void {
  if (!nativeCallSupported()) return
  CallNative.setPip({ enabled, ...aspect }).catch(warn('setPip'))
}

/** Subscribe to the activity entering/leaving PiP. Returns an unsubscribe function. */
export function onPipChange(cb: (active: boolean) => void): () => void {
  if (!nativeCallSupported()) return () => {}
  let handle: PluginListenerHandle | null = null
  let cancelled = false
  CallNative.addListener('pipChange', (e) => cb(e.active))
    .then((h) => { if (cancelled) h.remove(); else handle = h })
    .catch(warn('pipChange'))
  return () => { cancelled = true; handle?.remove() }
}

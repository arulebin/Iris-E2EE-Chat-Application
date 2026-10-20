import { requireOptionalNativeModule } from 'expo-modules-core'

export type NativeCallAction = {
  action: 'open' | 'answer' | 'decline' | 'hangup'
  callId?: string | null
  from?: string | null
  name?: string | null
  video?: boolean
}

export type AudioState = { speaker: boolean; bluetooth: boolean; wired: boolean; headset: boolean }

type Subscription = { remove(): void }

/** Shape of the Kotlin module (modules/iris-calls/android). Android only. */
export interface IrisCallsNative {
  attach(): NativeCallAction[]
  detach(): void
  showIncoming(callId: string, from: string, name: string, video: boolean): void
  dismissIncoming(callId: string | null): void
  canUseFullScreenIntent(): boolean
  openFullScreenIntentSettings(): boolean
  startSession(callId: string, peer: string, video: boolean, outgoing: boolean, speaker: boolean): void
  updateSession(peer: string, video: boolean): void
  connected(callId: string): void
  endSession(callId: string | null): void
  setSpeaker(on: boolean): void
  audioState(): AudioState
  setProximity(on: boolean): void
  playRingback(): void
  playRingtone(): void
  stopTones(): void
  setKeepAwake(on: boolean): void
  setShowOverLockscreen(on: boolean): void
  moveTaskToBack(): void
  setPip(enabled: boolean, width: number, height: number): void
  isInPip(): boolean
  addListener(event: 'onCallAction', cb: (e: NativeCallAction) => void): Subscription
  addListener(event: 'onPipChange', cb: (e: { active: boolean }) => void): Subscription
  addListener(event: 'onAudioDevices', cb: (e: AudioState) => void): Subscription
}

/** Null on iOS / web / Expo Go, where the module does not exist. Every caller must tolerate that. */
export const IrisCalls: IrisCallsNative | null = requireOptionalNativeModule<IrisCallsNative>('IrisCalls')

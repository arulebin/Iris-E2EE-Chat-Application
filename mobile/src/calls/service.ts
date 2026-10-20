// Public API of the calls feature. The app (UI/state layer and platform adapters)
// only needs this file plus <CallOverlay/> from ./ui/CallOverlay:
//
//   configureCalls({ apiBase, getToken, screenSecurity, nameOf })   once, at app start
//   attachCallTransport(transport)       when the chat WebSocket exists (null on sign-out)
//   startCall(peer, 'audio' | 'video')   from the chat header buttons
//   handleIncomingCallPush(data)         from the FCM data handler (JS side; see docs/mobile-calls.md)
//   useCall()                            state for custom UI (e.g. "On call" banner in a chat)
import { useSyncExternalStore } from 'react'
import { startNativeBindings, type ScreenSecurity } from './bindings'
import { CallEngine, type CallSnapshot } from './engine'
import { ensureCallPermissions } from './permissions'
import { createRnWebrtcDriver } from './rtc'
import type { CallMode, CallSignalingTransport } from './types'

export type CallsConfig = {
  /** Backend origin, e.g. https://api.iris.example (no trailing slash). */
  apiBase: string
  /** Current access token for GET /api/turn/credentials. */
  getToken: () => string | null | Promise<string | null>
  /** Platform screenSecurity (FLAG_SECURE) — acquired for the whole call. */
  screenSecurity?: ScreenSecurity
  /** username -> display name used in notifications and the system call UI. */
  nameOf?: (username: string) => string
  /** Called once an incoming call is accepted (e.g. to open that chat). */
  onAccepted?: (peer: string) => void
  log?: (...a: unknown[]) => void
}

let engine: CallEngine | null = null
let config: CallsConfig | null = null
let teardown: (() => void) | null = null
let transport: CallSignalingTransport | null = null

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // RN without a crypto polyfill: RFC4122 v4 from Math.random is fine for a call id (not a secret).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function configureCalls(cfg: CallsConfig): CallEngine {
  teardown?.()
  config = cfg
  engine = new CallEngine({
    driver: createRnWebrtcDriver({ apiBase: cfg.apiBase, getToken: cfg.getToken, log: cfg.log }),
    uuid,
    log: cfg.log,
  })
  if (transport) engine.attachTransport(transport)
  teardown = startNativeBindings(engine, {
    screenSecurity: cfg.screenSecurity,
    nameOf: cfg.nameOf,
    accept: acceptCall,
    log: cfg.log,
  })
  return engine
}

export function isCallsConfigured(): boolean {
  return engine !== null
}

export function getCallEngine(): CallEngine {
  if (!engine) throw new Error('configureCalls() must run before using calls')
  return engine
}

/** Wire the chat socket. Pass null on sign-out / socket teardown. */
export function attachCallTransport(t: CallSignalingTransport | null) {
  transport = t
  engine?.attachTransport(t)
}

/** Ask for mic (+camera) then dial. Resolves once the offer is sent (or the call failed to start). */
export async function startCall(peer: string, mode: CallMode): Promise<void> {
  const e = getCallEngine()
  if (e.getSnapshot().state.kind !== 'idle') return
  if (!(await ensureCallPermissions(mode))) {
    e.startCall(peer, mode).catch(() => {}) // surfaces the "allow microphone" notice through the normal failure path
    return
  }
  await e.startCall(peer, mode)
}

/** Answer the ringing call (video calls can be answered voice-only). */
export async function acceptCall(withVideo = true): Promise<void> {
  const e = getCallEngine()
  const s = e.getSnapshot().state
  if (s.kind !== 'incoming') return
  const ok = await ensureCallPermissions(s.mode === 'video' && withVideo ? 'video' : 'audio')
  if (!ok) { e.reject(); return }
  config?.onAccepted?.(s.from)
  await e.accept(withVideo)
}

export const declineCall = () => getCallEngine().reject()
export const hangUp = () => getCallEngine().hangUp()

/**
 * Payload of the high-priority FCM data message that announces a call. The backend
 * currently sends a generic notification; see docs/mobile-calls.md for the proposal.
 */
export type IncomingCallPush = {
  type: 'incoming-call'
  callId: string
  from: string
  mode?: CallMode | 'audio' | 'video'
  name?: string
}

/**
 * JS half of the push handoff, for when the app process is alive (background) or
 * has just been started by the push. Shows the incoming UI immediately; the held
 * offer arrives through the socket and fills it in.
 */
export function handleIncomingCallPush(data: Record<string, unknown>): boolean {
  if (data.type === 'call-cancelled' && typeof data.callId === 'string') {
    const e = getCallEngine()
    const s = e.getSnapshot().state
    if (s.kind === 'incoming' && s.callId === data.callId) e.reject()
    return true
  }
  if (data.type !== 'incoming-call' || typeof data.callId !== 'string' || typeof data.from !== 'string') return false
  getCallEngine().announceIncoming({
    from: data.from, callId: data.callId, mode: data.mode === 'audio' ? 'audio' : 'video',
  })
  return true
}

export function useCall(): CallSnapshot & { engine: CallEngine } {
  const e = getCallEngine()
  const snap = useSyncExternalStore(e.subscribe, e.getSnapshot, e.getSnapshot)
  return { ...snap, engine: e }
}

export function useCallSnapshot(): CallSnapshot {
  const e = getCallEngine()
  return useSyncExternalStore(e.subscribe, e.getSnapshot, e.getSnapshot)
}

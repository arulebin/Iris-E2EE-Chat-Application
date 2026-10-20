// Connects the platform-neutral engine to the device: native audio/ringtones,
// foreground service + Telecom, PiP, proximity, keep-awake, FLAG_SECURE, network
// changes and the Answer/Decline buttons of the native incoming-call UI.
import NetInfo from '@react-native-community/netinfo'
import { AppState } from 'react-native'
import { IrisCalls, type AudioState, type NativeCallAction } from '../../modules/iris-calls'
import type { CallEngine, CallSnapshot } from './engine'
import { currentCall } from './signals'
import type { CallMode } from './types'

export interface ScreenSecurity {
  /** Turn FLAG_SECURE on (ref-counted by the platform layer). Returns the release function. */
  acquire(reason: string): () => void
}

export type BindingOptions = {
  screenSecurity?: ScreenSecurity
  /** Display name for notifications / system UI. */
  nameOf?: (username: string) => string
  /** Request mic/camera first, then accept (wired by service.ts). */
  accept: (withVideo: boolean) => Promise<void>
  log?: (...a: unknown[]) => void
}

const isVideo = (s: CallSnapshot) => s.state.kind === 'active' && s.state.mode === 'video'

export function startNativeBindings(engine: CallEngine, o: BindingOptions): () => void {
  const log = o.log ?? (() => {})
  const offs: Array<() => void> = []
  const nameOf = o.nameOf ?? ((u: string) => u)

  let prev: CallSnapshot | null = null
  let releaseSecure: (() => void) | null = null
  let audio: AudioState = { speaker: false, bluetooth: false, wired: false, headset: false }
  /** Calls the native layer already started ringing for (push / Telecom), so we don't ring twice. */
  const nativeRinging = new Set<string>()

  const peerOf = (s: CallSnapshot) => currentCall(s.state)?.peer ?? ''

  function proximityWanted(s: CallSnapshot) {
    return s.state.kind === 'active' && s.state.mode === 'audio' && !s.speakerOn && !audio.headset
  }

  function apply(s: CallSnapshot) {
    const p = prev
    prev = s
    const kind = s.state.kind
    const pkind = p?.state.kind ?? 'idle'
    const cur = currentCall(s.state)
    const pcur = p ? currentCall(p.state) : null
    const callChanged = cur?.callId !== pcur?.callId

    // Privacy: no screenshots / recents thumbnails while a call is up.
    if (kind !== 'idle' && !releaseSecure && o.screenSecurity) releaseSecure = o.screenSecurity.acquire('call')
    if (kind === 'idle' && releaseSecure) { releaseSecure(); releaseSecure = null }

    if (!IrisCalls) return

    if (kind === 'idle') {
      if (pkind !== 'idle') {
        IrisCalls.endSession(pcur?.callId ?? null)
        nativeRinging.clear()
      }
      return
    }

    if (kind === 'outgoing' && (pkind !== 'outgoing' || callChanged) && s.state.kind === 'outgoing') {
      IrisCalls.startSession(s.state.callId, nameOf(s.state.to), s.state.mode === 'video', true, s.speakerOn)
      IrisCalls.playRingback()
    }

    if (kind === 'incoming' && s.state.kind === 'incoming' && (pkind !== 'incoming' || callChanged)) {
      const st = s.state
      IrisCalls.setShowOverLockscreen(true)
      if (!nativeRinging.has(st.callId)) {
        if (AppState.currentState === 'active') IrisCalls.playRingtone()
        else {
          IrisCalls.showIncoming(st.callId, st.from, nameOf(st.from), st.mode === 'video')
          nativeRinging.add(st.callId)
        }
      }
    }

    if (kind === 'incoming' && s.accepting && !p?.accepting) {
      IrisCalls.dismissIncoming(cur?.callId ?? null)
      IrisCalls.stopTones()
      if (s.state.kind === 'incoming') {
        IrisCalls.startSession(s.state.callId, nameOf(s.state.from), s.state.mode === 'video', false, s.state.mode === 'video')
      }
    }

    if (kind === 'active' && s.state.kind === 'active') {
      if (pkind !== 'active') {
        IrisCalls.stopTones()
        IrisCalls.connected(s.state.callId)
        if (pkind === 'idle') {
          IrisCalls.startSession(s.state.callId, nameOf(s.state.peer), s.state.mode === 'video', false, s.speakerOn)
        }
      }
      if (p?.state.kind === 'active' && p.state.mode !== s.state.mode) {
        IrisCalls.updateSession(nameOf(s.state.peer), s.state.mode === 'video')
      }
    }

    if (p && p.speakerOn !== s.speakerOn && kind !== 'incoming') IrisCalls.setSpeaker(s.speakerOn)

    // Window / sensors.
    const video = isVideo(s)
    if (video !== (p ? isVideo(p) : false)) {
      IrisCalls.setKeepAwake(video)
      IrisCalls.setPip(video, 9, 16)
    }
    if (proximityWanted(s) !== (p ? proximityWanted(p) : false)) IrisCalls.setProximity(proximityWanted(s))
  }

  offs.push(engine.subscribe(() => apply(engine.getSnapshot())))

  // ── native -> JS ─────────────────────────────────────────────
  const native = IrisCalls
  if (native) {
    const onAction = (a: NativeCallAction) => {
      log('[call] native action', a.action, a.callId)
      const s = engine.getSnapshot().state
      const video = !!a.video
      const mode: CallMode = video ? 'video' : 'audio'
      const known = currentCall(s)
      switch (a.action) {
        case 'open':
          if (s.kind === 'idle' && a.callId && a.from) engine.announceIncoming({ from: a.from, callId: a.callId, mode })
          break
        case 'answer':
          if (s.kind === 'idle' && a.callId && a.from) engine.announceIncoming({ from: a.from, callId: a.callId, mode })
          if (known && a.callId && known.callId !== a.callId) break
          void o.accept(true)
          break
        case 'decline':
          if (s.kind === 'idle' && a.callId && a.from) engine.announceIncoming({ from: a.from, callId: a.callId, mode })
          if (!known || !a.callId || known.callId === a.callId) {
            engine.reject()
            // Declined from the notification of a dead app: go back to wherever the user was.
            if (AppState.currentState === 'active') native.moveTaskToBack()
          }
          break
        case 'hangup':
          if (s.kind !== 'idle') engine.hangUp()
          break
      }
    }
    const sub1 = native.addListener('onCallAction', onAction)
    const sub2 = native.addListener('onPipChange', ({ active }) => {
      // PiP shows the call chrome-less: the overlay reads this to hide controls.
      pipListeners.forEach((l) => l(active))
    })
    const sub3 = native.addListener('onAudioDevices', (st) => {
      audio = st
      if (prev) native.setProximity(proximityWanted(prev))
    })
    offs.push(() => { sub1.remove(); sub2.remove(); sub3.remove() })
    // Anything that happened before React mounted (Answer tapped on a dead app).
    for (const a of native.attach()) onAction(a)
    offs.push(() => native.detach())
  }

  // ── network changes -> ICE restart ───────────────────────────
  let netKey: string | null = null
  let netTimer: ReturnType<typeof setTimeout> | null = null
  offs.push(NetInfo.addEventListener((n) => {
    const key = `${n.type}|${n.isConnected ? 1 : 0}|${(n.details as { ipAddress?: string } | null)?.ipAddress ?? ''}`
    const changed = netKey !== null && key !== netKey && n.isConnected
    netKey = key
    if (!changed) return
    if (netTimer) clearTimeout(netTimer)
    netTimer = setTimeout(() => engine.networkChanged(), 600) // let the new interface settle
  }))
  offs.push(() => { if (netTimer) clearTimeout(netTimer) })

  return () => {
    for (const off of offs) off()
    if (releaseSecure) { releaseSecure(); releaseSecure = null }
  }
}

// PiP state fan-out (read by useIsPip in the UI).
const pipListeners = new Set<(active: boolean) => void>()
export function subscribePip(cb: (active: boolean) => void): () => void {
  pipListeners.add(cb)
  return () => { pipListeners.delete(cb) }
}

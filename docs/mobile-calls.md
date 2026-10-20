# Mobile voice and video calls

Status: implemented in `mobile/src/calls/**` and the Android Expo module
`mobile/modules/iris-calls/**`. The server protocol is unchanged: it is the one in
`backend/.../CallRelay.java` and the web client (`frontend/src/lib/call`).

## Layers

```
src/calls/engine.ts      pure TS state machine (no React, no RN): offer/answer/ICE, glare, busy,
                         multi-device, ICE restart, 30 s reconnect window, voice->video upgrade.
                         Unit-tested with fakes (engine.test.ts, protocol.test.ts).
src/calls/rtc.ts         react-native-webrtc RtcDriver + GET /api/turn/credentials
src/calls/bindings.ts    engine <-> device: ringtones, FGS, Telecom, PiP, proximity, FLAG_SECURE, NetInfo
src/calls/service.ts     public API (configureCalls, startCall, ...)
src/calls/ui/*           CallOverlay and screens (Reanimated 4 + gesture-handler 3)
modules/iris-calls/      Kotlin: Telecom self-managed ConnectionService, foreground service,
                         notifications (full-screen intent), audio routing, tones, PiP
```

## Integration API

```tsx
// once at startup
configureCalls({ apiBase, getToken, screenSecurity, nameOf, onAccepted })

// when the chat WebSocket exists (null on sign-out)
attachCallTransport(transport) // CallSignalingTransport: send/isOpen/onSignal/onOpen

// chat header buttons
startCall(peer, 'audio' | 'video')

// root layout, last child inside SafeAreaProvider
<CallOverlay profileOf={...} onQuickReply={(peer, text) => ...} />
```

`CallSignalingTransport` (in `src/calls/types.ts`) is the only thing the platform layer must
provide. Frames are plain JSON with `type` starting with `call-`; `decodeSignal(raw)` returns
the signal or null so the socket handler can route non-call frames elsewhere. Call
`onOpen` listeners on every (re)connect: the engine re-pins the call (`call-resume`) and
flushes queued hang-ups.

`screenSecurity.acquire('call')` must return a release function. It is held for the whole call.

Dev harness: `iris://call/dev` (`app/call/dev.tsx`) exercises every screen without a backend.

## Incoming call when the app is dead (push)

Android only runs our code for **data-only, high-priority** FCM messages. The platform/push
layer owns FCM registration and the `FirebaseMessagingService`; it calls into the native
helper before touching JS:

```kotlin
override fun onMessageReceived(m: RemoteMessage) {
  if (com.iris.calls.IrisCallPush.handle(applicationContext, m.data)) return
  // ... other message types
}
```

`IrisCallPush.handle` (no JS running) registers the call with Telecom (system incoming-call UI,
lock-screen full-screen intent, ringtone + vibration) and falls back to a plain high-priority
full-screen notification. Answer opens `MainActivity`; JS mounts, `configureCalls` +
`attachCallTransport` run, the socket connects, and the relay replays the held offer
(`CallRelay.onConnect`, 45 s window). Until the offer arrives the incoming UI is shown from the
push data and Answer is queued (`engine.announceIncoming` + `accepting`). Decline taps are
remembered and sent as soon as the offer names the caller.

If the process is alive in the background, forward the same data to
`handleIncomingCallPush(data)` instead.

### Payload expected (proposal, backend change needed)

Today the backend sends a generic *notification* ("Incoming call"). A notification message
is displayed by the system without running our code, so it can never ring or open the
full-screen UI. Proposal, keeping the privacy rule of `docs/android-push.md` (no names through
Google):

```json
{ "data": { "type": "incoming-call", "callId": "<uuid>", "mode": "audio|video" },
  "android": { "priority": "HIGH", "ttl": "45s" } }
```

and when the caller cancels, the call is answered elsewhere, or the 45 s window expires:

```json
{ "data": { "type": "call-cancelled", "callId": "<uuid>" }, "android": { "priority": "HIGH", "ttl": "10s" } }
```

Minimal backend change: in `CallRelay` `call-offer` branch replace
`push.sendToUser(to, "Iris", "Incoming call", true)` with a data-only variant that carries
`callId` and `mode` (both already present in the frame), and send `call-cancelled` from the
`call-end` / `call-answer` branches when the callee has no live socket. No caller name is sent:
the system UI says "Iris" until the offer arrives (a second or two), then the name is filled in.
`from` / `name` are accepted in the payload if you decide the privacy trade-off is acceptable.

## Android system integration

| Feature | Where |
| --- | --- |
| Self-managed ConnectionService (system incoming UI, audio arbitration, Bluetooth/car) | `CallTelecom.kt` |
| Full-screen intent, Answer/Decline (CallStyle), Android 14 permission check/settings | `CallNotifier.kt`, `canUseFullScreenIntent()` / `openFullScreenIntentSettings()` |
| Foreground service `phoneCall\|microphone\|camera` | `CallForegroundService.kt` |
| Audio focus, speaker/earpiece/Bluetooth/wired (`setCommunicationDevice`, API 31+) | `CallAudio.kt` |
| Proximity screen-off (voice, no speaker/headset), keep-awake (video) | `CallAudio.kt`, `setKeepAwake` |
| Ringtone/vibration, ringback | `CallTones.kt` |
| Show over lock screen only for call launches | `IrisCallsPackage.kt` |
| Picture-in-picture (auto-enter API 31+, `onUserLeaveHint` before) | `IrisCallsPackage.kt`, config plugin |

Not handled: iOS (CallKit/PushKit), no Android-side hold, multiple simultaneous calls.

## Manual test plan

1. Voice call A->B, both foreground: ringback on A, ringtone on B, answer, audio both ways, timer, mute (peer sees indicator), speaker, end from either side.
2. Video call: self-view drag to all four corners with a flick, tap to swap, flip camera, camera off/on (peer sees "camera is off"), controls auto-hide after 4 s and return on tap.
3. Voice->video upgrade via the camera button; the peer's screen switches to video.
4. Minimise (chevron / back): floating window follows the finger, snaps to side edges, stays above navigation; drag to the bottom-centre target -> "On call" pill; tap pill/window returns.
5. Home during a video call: PiP window (Android 12+ auto, older on home gesture); expand returns to the call.
6. Lock screen: B locked, A calls (app foreground/background/killed with push): system incoming UI / full-screen intent shows over the lock screen with Answer/Decline; Answer connects without unlocking. Android 14: revoke "full-screen notifications" and confirm a heads-up notification still rings.
7. Two devices on B: both ring, answering on one dismisses the other ("Answered on another device"); decline on one stops the other.
8. B busy on another call: A gets "on another call". Glare: both call each other at once -> one call survives.
9. Caller cancels while B rings; B declines; no answer for 45 s ("Missed call").
10. Network: toggle Wi-Fi <-> mobile mid-call: "Reconnecting" banner then media returns; airplane mode 30 s -> call drops with notice.
11. Bluetooth headset connect/disconnect mid-call re-routes audio; wired headset likewise; proximity blanks the screen at the ear only when on earpiece.
12. Background 5+ minutes with the screen off: audio continues (foreground service notification visible), "Hang up" in the notification ends the call.
13. Screenshots are blocked during the call (FLAG_SECURE via platform screenSecurity).

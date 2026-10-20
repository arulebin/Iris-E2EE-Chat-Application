// Public surface of the calls feature (see docs/mobile-calls.md).
export {
  acceptCall, attachCallTransport, configureCalls, declineCall, getCallEngine, handleIncomingCallPush,
  hangUp, startCall, useCall, useCallSnapshot,
  type CallsConfig, type IncomingCallPush,
} from './service'
export { CallOverlay, type CallOverlayProps } from './ui/CallOverlay'
export type { ScreenSecurity } from './bindings'
export type { CallSignalingTransport, CallSignal, CallMode, CallState, CallSummary } from './types'
export { decodeSignal, encodeSignal, formatDuration } from './signals'

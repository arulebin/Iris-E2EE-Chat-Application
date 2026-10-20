import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeInUp, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IrisCalls } from '../../../modules/iris-calls'
import { subscribePip } from '../bindings'
import type { CallSnapshot } from '../engine'
import { acceptCall, declineCall, hangUp, isCallsConfigured, startCall, useCall } from '../service'
import { formatDuration } from '../signals'
import type { CallSummary } from '../types'
import { CallScreen } from './CallScreen'
import { CamIcon, PhoneIcon } from './icons'
import { IncomingScreen } from './IncomingScreen'
import { CallPill, MiniWindow, PipView } from './MiniAndPill'
import { Avatar, CALL_BG, GREEN, PeerProfile, RoundButton } from './parts'

export type CallOverlayProps = {
  /** Display name + avatar for a username. */
  profileOf?: (username: string) => PeerProfile | undefined
  /** "Decline and reply": decline, then send `text` to `peer` in the chat. Hides the Message button when omitted. */
  onQuickReply?: (peer: string, text: string) => void
}

function useIsPip(): boolean {
  const [pip, setPip] = useState(() => { try { return IrisCalls?.isInPip() ?? false } catch { return false } })
  useEffect(() => subscribePip(setPip), [])
  return pip
}

/**
 * Mount ONCE, as the last child of the root layout (inside SafeAreaProvider), so it
 * sits above navigation:
 *
 *   <Stack/>
 *   <CallOverlay profileOf={...} onQuickReply={...} />
 *
 * Renders nothing when there is no call, and never blocks touches outside its own
 * widgets (pointerEvents="box-none").
 */
/** Renders nothing until configureCalls() has run, so mounting order can never crash the app. */
export function CallOverlay(props: CallOverlayProps) {
  if (!isCallsConfigured()) return null
  return <ConfiguredOverlay {...props} />
}

function ConfiguredOverlay({ profileOf, onQuickReply }: CallOverlayProps) {
  const call = useCall()
  const { engine, state } = call
  const pip = useIsPip()
  const peer = state.kind === 'outgoing' ? state.to : state.kind === 'active' ? state.peer : state.kind === 'incoming' ? state.from : ''
  const profile = peer ? profileOf?.(peer) : undefined
  const name = profile?.name || peer || 'Iris'
  const snap: CallSnapshot = call

  const showSummary = state.kind === 'idle' && call.summary && summaryWorthShowing(call.summary)

  return (
    <>
      {/* Plain box-none View only: a nested GestureHandlerRootView / SafeAreaProvider swallows every touch
          on Android even when idle. The app root provides both, and the overlay must sit inside them. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {state.kind === 'incoming' && (
          <IncomingScreen
            name={name}
            avatarUrl={profile?.avatarUrl}
            video={state.mode === 'video'}
            accepting={call.accepting}
            onAccept={() => void acceptCall(true)}
            onAcceptVoice={() => void acceptCall(false)}
            onDecline={declineCall}
            onQuickReply={onQuickReply && peer ? (t) => { declineCall(); onQuickReply(peer, t) } : undefined}
          />
        )}

        {(state.kind === 'outgoing' || state.kind === 'active') && (
          pip ? <PipView snap={snap} name={name} avatarUrl={profile?.avatarUrl} />
            : !call.minimized ? (
              <CallScreen snap={snap} engine={engine} name={name} avatarUrl={profile?.avatarUrl}
                onHangUp={hangUp} onToggleCamera={() => void engine.toggleCamera()} />
            ) : !call.previewHidden ? (
              <MiniWindow snap={snap} engine={engine} name={name} avatarUrl={profile?.avatarUrl} />
            ) : (
              <CallPill snap={snap} engine={engine} name={name} />
            )
        )}

        {showSummary && call.summary && (
          <EndedScreen
            summary={call.summary}
            profile={profileOf?.(call.summary.peer)}
            onClose={engine.dismissSummary.bind(engine)}
            onCallBack={(mode) => { engine.dismissSummary(); void startCall(call.summary!.peer, mode) }}
          />
        )}

        {call.notice && <NoticeBanner message={call.notice} onDismiss={engine.dismissNotice.bind(engine)} />}
      </View>
    </>
  )
}

/** Calls that ended by our own hand (cancel, decline) need no ended screen. */
function summaryWorthShowing(s: CallSummary): boolean {
  if (s.outcome === 'canceled') return false
  if (s.outcome === 'declined' && s.direction === 'incoming') return false
  if (s.outcome === 'other') return false
  return true
}

function NoticeBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOut.duration(160)} pointerEvents="box-none" style={[styles.noticeWrap, { top: insets.top + 8 }]}>
      <Pressable onPress={onDismiss} style={styles.notice} accessibilityRole="alert">
        <Text style={styles.noticeText}>{message}</Text>
      </Pressable>
    </Animated.View>
  )
}

const OUTCOME: Record<CallSummary['outcome'], string> = {
  completed: 'Call ended',
  missed: 'Missed call',
  declined: 'Call declined',
  'no-answer': 'No answer',
  busy: 'Line busy',
  failed: 'Call dropped',
  canceled: 'Call canceled',
  other: 'Call ended',
}

function EndedScreen({ summary, profile, onClose, onCallBack }: {
  summary: CallSummary
  profile?: PeerProfile
  onClose: () => void
  onCallBack: (mode: 'audio' | 'video') => void
}) {
  const insets = useSafeAreaInsets()
  const name = profile?.name || summary.peer
  // Quietly goes away; a missed call stays until acknowledged.
  useEffect(() => {
    if (summary.outcome === 'missed') return
    const id = setTimeout(onClose, 4500)
    return () => clearTimeout(id)
  }, [summary, onClose])

  const detail = summary.outcome === 'completed' || summary.outcome === 'failed'
    ? `${summary.mode === 'video' ? 'Video' : 'Voice'} call · ${formatDuration(summary.durationSec)}`
    : `${summary.mode === 'video' ? 'Video' : 'Voice'} call`

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} style={[StyleSheet.absoluteFill, styles.ended, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={styles.endedCenter} pointerEvents="none">
        <Avatar name={name} uri={profile?.avatarUrl} size={112} />
        <Text style={styles.endedName} numberOfLines={1}>{name}</Text>
        <Text style={[styles.endedOutcome, (summary.outcome === 'missed' || summary.outcome === 'failed') && { color: '#ff8a8e' }]}>{OUTCOME[summary.outcome]}</Text>
        <Text style={styles.endedDetail}>{detail}</Text>
      </View>
      <View style={styles.endedActions}>
        <View style={styles.endedCol}>
          <RoundButton label="Close" onPress={onClose} size={56}><Text style={styles.close}>✕</Text></RoundButton>
          <Text style={styles.endedCaption}>Close</Text>
        </View>
        <View style={styles.endedCol}>
          <RoundButton label="Call back" onPress={() => onCallBack('audio')} success size={64}><PhoneIcon size={28} /></RoundButton>
          <Text style={styles.endedCaption}>Call back</Text>
        </View>
        <View style={styles.endedCol}>
          <RoundButton label="Video call back" onPress={() => onCallBack('video')} size={56}><CamIcon size={24} /></RoundButton>
          <Text style={styles.endedCaption}>Video</Text>
        </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  noticeWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 200 },
  notice: { backgroundColor: 'rgba(20,22,30,0.94)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, maxWidth: '100%' },
  noticeText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  ended: { backgroundColor: CALL_BG, zIndex: 110, alignItems: 'center', justifyContent: 'space-between' },
  endedCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  endedName: { color: '#fff', fontSize: 28, fontWeight: '600', marginTop: 14, maxWidth: '85%' },
  endedOutcome: { color: GREEN, fontSize: 17, fontWeight: '500' },
  endedDetail: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  endedActions: { flexDirection: 'row', alignItems: 'flex-end', gap: 30 },
  endedCol: { alignItems: 'center', gap: 8 },
  endedCaption: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  close: { color: '#fff', fontSize: 20 },
})

import { useEffect, useState } from 'react'
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  Easing, FadeIn, FadeInDown, SlideInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CamIcon, LockIcon, MessageIcon, PhoneIcon } from './icons'
import { ACCENT, Avatar, CALL_BG, RoundButton } from './parts'

export const QUICK_REPLIES = [
  "Can't talk right now. What's up?",
  "I'll call you back in a bit.",
  "Can't talk now, text me.",
]

type Props = {
  name: string
  avatarUrl?: string
  video: boolean
  /** Pressed Answer; the media + negotiation is in flight (waiting for the held offer after a push). */
  accepting: boolean
  onAccept: () => void
  onAcceptVoice: () => void
  onDecline: () => void
  /** Decline and send this text to the caller (wired by the chat layer; placeholder otherwise). */
  onQuickReply?: (text: string) => void
}

function PulseRing({ delay }: { delay: number }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false))
  }, [delay, p])
  const style = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - p.value), transform: [{ scale: 1 + p.value * 0.9 }] }))
  return <Animated.View pointerEvents="none" style={[styles.ring, style]} />
}

export function IncomingScreen({ name, avatarUrl, video, accepting, onAccept, onAcceptVoice, onDecline, onQuickReply }: Props) {
  const insets = useSafeAreaInsets()
  const [replies, setReplies] = useState(false)

  // Back must not silently drop a ringing call.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (replies) { setReplies(false); return true }
      return true
    })
    return () => sub.remove()
  }, [replies])

  return (
    <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.center}>
        <View style={styles.avatarWrap}>
          <PulseRing delay={0} />
          <PulseRing delay={800} />
          <Avatar name={name} uri={avatarUrl} size={132} />
        </View>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.sub}>{accepting ? 'Connecting…' : `Iris ${video ? 'video' : 'voice'} call`}</Text>
        <View style={styles.e2e}>
          <LockIcon size={13} color="rgba(255,255,255,0.45)" />
          <Text style={styles.e2eText}>End-to-end encrypted</Text>
        </View>
      </View>

      {accepting ? (
        <View style={styles.connecting}><ActivityIndicator color="#fff" /></View>
      ) : (
        <Animated.View entering={FadeInDown.delay(120).duration(260)} style={styles.actions}>
          {onQuickReply && (
            <Pressable accessibilityRole="button" accessibilityLabel="Reply with a message" onPress={() => setReplies(true)} style={styles.replyBtn}>
              <MessageIcon size={18} color="#fff" />
              <Text style={styles.replyText}>Message</Text>
            </Pressable>
          )}
          <View style={styles.row}>
            <View style={styles.col}>
              <RoundButton label="Decline" onPress={onDecline} danger size={68}><PhoneIcon hangup size={30} /></RoundButton>
              <Text style={styles.caption}>Decline</Text>
            </View>
            {video && (
              <View style={styles.col}>
                <RoundButton label="Answer with camera off" onPress={onAcceptVoice} size={56}><CamIcon off size={24} /></RoundButton>
                <Text style={styles.caption}>Voice only</Text>
              </View>
            )}
            <View style={styles.col}>
              <RoundButton label={video ? 'Answer with video' : 'Answer'} onPress={onAccept} success size={68}>
                {video ? <CamIcon size={30} /> : <PhoneIcon size={30} />}
              </RoundButton>
              <Text style={styles.caption}>{video ? 'Video' : 'Answer'}</Text>
            </View>
          </View>
        </Animated.View>
      )}

      {replies && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReplies(false)} accessibilityLabel="Close replies" />
          <Animated.View entering={SlideInDown.duration(220)} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>Decline and reply</Text>
            {QUICK_REPLIES.map((t) => (
              <Pressable key={t} accessibilityRole="button" onPress={() => { setReplies(false); onQuickReply?.(t) }} style={({ pressed }) => [styles.reply, pressed && { opacity: 0.7 }]}>
                <Text style={styles.replyItem}>{t}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: CALL_BG, alignItems: 'center', justifyContent: 'space-between', zIndex: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  avatarWrap: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  ring: { position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: ACCENT },
  name: { color: '#fff', fontSize: 30, fontWeight: '600', letterSpacing: -0.4, maxWidth: '90%' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 15 },
  e2e: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  e2eText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  actions: { width: '100%', alignItems: 'center', gap: 28, paddingHorizontal: 32 },
  row: { width: '100%', maxWidth: 360, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  col: { alignItems: 'center', gap: 8 },
  caption: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  connecting: { height: 120, alignItems: 'center', justifyContent: 'center' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  replyText: { color: '#fff', fontSize: 14 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#171a23', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 18, paddingHorizontal: 20, gap: 4 },
  sheetTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 6 },
  reply: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  replyItem: { color: '#fff', fontSize: 16 },
})


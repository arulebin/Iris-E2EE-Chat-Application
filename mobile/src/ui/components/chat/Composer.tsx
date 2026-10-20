import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { FadeInDown, FadeOutDown, interpolate, interpolateColor, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReplyRef } from '@/state/services'
import { haptic } from '../../lib/haptics'
import { fonts, useTheme } from '../../theme'
import { Icon } from '../Icon'
import { Text } from '../Text'
import { useToast } from '../Toast'

interface Props {
  reply: ReplyRef | null
  onCancelReply: () => void
  onSend: (text: string) => void
  onTyping: (typing: boolean) => void
  placeholder?: string
}

/** Message composer: auto-growing input, reply preview, attach/emoji placeholders, mic -> send morph. */
export function Composer({ reply, onCancelReply, onSend, onTyping, placeholder = 'Message' }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const toast = useToast()
  const [text, setText] = useState('')
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kb = useReanimatedKeyboardAnimation()
  const has = useSharedValue(0)
  const hasText = text.trim().length > 0

  useEffect(() => {
    has.value = withSpring(hasText ? 1 : 0, { damping: 16, stiffness: 260 })
  }, [hasText, has])

  useEffect(() => {
    if (reply) input.current?.focus()
  }, [reply])

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
    },
    [],
  )

  const pad = useAnimatedStyle(() => ({ paddingBottom: interpolate(kb.progress.value, [0, 1], [insets.bottom + 8, 8]) }))
  const sendBg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(has.value, [0, 1], [t.surfaceAlt, t.primary]), transform: [{ scale: 0.92 + 0.08 * has.value }] }))
  const sendIcon = useAnimatedStyle(() => ({ opacity: has.value, transform: [{ scale: has.value }, { rotate: `${(1 - has.value) * -45}deg` }] }))
  const micIcon = useAnimatedStyle(() => ({ opacity: 1 - has.value, transform: [{ scale: 1 - has.value }] }))

  function onChange(v: string) {
    setText(v)
    onTyping(v.length > 0)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => onTyping(false), 2500)
  }

  function submit() {
    const v = text.trim()
    if (!v) return
    haptic.tap()
    onSend(v)
    setText('')
    onTyping(false)
  }

  return (
    <Animated.View style={[styles.wrap, { backgroundColor: t.bg, borderTopColor: t.hairline }, pad]}>
      {reply ? (
        <Animated.View entering={FadeInDown.duration(160)} exiting={FadeOutDown.duration(120)} style={[styles.reply, { backgroundColor: t.surface, borderLeftColor: t.primary }]}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" weight="bold" tone="primary" numberOfLines={1}>
              Replying to {reply.senderName}
            </Text>
            <Text variant="small" tone="muted" numberOfLines={1}>
              {reply.text}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
            <Icon name="close" size={20} color={t.muted} />
          </Pressable>
        </Animated.View>
      ) : null}
      <Animated.View layout={LinearTransition.duration(120)} style={styles.row}>
        <View style={[styles.field, { backgroundColor: t.surface, borderColor: t.hairline }]}>
          <Pressable onPress={() => toast.show('Emoji picker coming soon')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Emoji" style={styles.fieldIcon}>
            <Icon name="happy-outline" size={24} color={t.muted} />
          </Pressable>
          <TextInput
            ref={input}
            value={text}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            multiline
            style={[styles.input, { color: t.ink, fontFamily: fonts.regular }]}
            selectionColor={t.primary}
            accessibilityLabel="Message input"
            textAlignVertical="center"
            scrollEnabled
          />
          <Pressable onPress={() => toast.show('Attachments arrive with the media update')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach" style={styles.fieldIcon}>
            <Icon name="attach" size={24} color={t.muted} />
          </Pressable>
        </View>
        <Pressable
          onPress={hasText ? submit : () => toast.show('Voice messages coming soon')}
          accessibilityRole="button"
          accessibilityLabel={hasText ? 'Send message' : 'Record voice message'}
        >
          <Animated.View style={[styles.send, sendBg]}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.center, micIcon]}>
              <Icon name="mic" size={22} color={t.muted} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.center, sendIcon]}>
              <Icon name="send" size={20} color="#fff" />
            </Animated.View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, minHeight: 48 },
  fieldIcon: { width: 38, height: 46, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 16, lineHeight: 21, maxHeight: 120, paddingTop: 13, paddingBottom: 12, paddingHorizontal: 4 },
  send: { width: 48, height: 48, borderRadius: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 4, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
})

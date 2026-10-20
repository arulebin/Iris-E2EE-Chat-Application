import { memo, useRef, type ComponentRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import type { Message } from '@/state/services'
import { haptic } from '../../lib/haptics'
import { clockTime } from '../../lib/timeline'
import { useTheme } from '../../theme'
import { avatarColors } from '../Avatar'
import { Icon } from '../Icon'
import { Text } from '../Text'
import { Ticks } from '../Ticks'

export interface BubbleLayout {
  x: number
  y: number
  width: number
  height: number
}

interface BodyProps {
  message: Message
  first: boolean
  last: boolean
  group: boolean
}

/** The visual bubble only (also reused by the long-press context menu preview). */
export function BubbleBody({ message, first, last, group }: BodyProps) {
  const t = useTheme()
  const mine = message.fromMe
  const bg = mine ? t.bubbleOut : t.bubbleIn
  const ink = mine ? t.bubbleOutInk : t.bubbleInInk
  const muted = mine ? t.bubbleOutMuted : t.muted
  const R = 20
  const r = 5
  const radii = mine
    ? { borderTopLeftRadius: R, borderBottomLeftRadius: R, borderTopRightRadius: first ? R : r, borderBottomRightRadius: last ? R : r }
    : { borderTopRightRadius: R, borderBottomRightRadius: R, borderTopLeftRadius: first ? R : r, borderBottomLeftRadius: last ? R : r }
  const showName = group && !mine && first
  return (
    <View style={[styles.bubble, radii, { backgroundColor: bg }, !mine && { borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline }]}>
      {showName ? (
        <Text variant="caption" weight="bold" color={avatarColors(message.senderId)[0]} style={{ marginBottom: 2 }}>
          {message.senderName}
        </Text>
      ) : null}
      {message.replyTo ? (
        <View style={[styles.quote, { backgroundColor: mine ? 'rgba(255,255,255,0.16)' : t.surfaceAlt, borderLeftColor: mine ? '#fff' : t.primary }]}>
          <Text variant="caption" weight="bold" color={mine ? '#fff' : t.primary} numberOfLines={1}>
            {message.replyTo.senderName}
          </Text>
          <Text variant="small" color={mine ? 'rgba(255,255,255,0.85)' : t.inkSoft} numberOfLines={2}>
            {message.replyTo.text}
          </Text>
        </View>
      ) : null}
      <View style={styles.content}>
        <Text color={ink} style={styles.text}>
          {message.text}
        </Text>
        <View style={styles.meta}>
          <Text variant="caption" color={muted} style={{ fontSize: 11 }}>
            {clockTime(message.at)}
          </Text>
          {mine ? <Ticks status={message.status} size={15} onBubble /> : null}
        </View>
      </View>
    </View>
  )
}

function ReplyAction({ translation }: { translation: SharedValue<number> }) {
  const t = useTheme()
  useAnimatedReaction(
    () => translation.value >= 52,
    (now, prev) => {
      if (now && !prev) runOnJS(haptic.medium)()
    },
  )
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(translation.value, [8, 40], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(translation.value, [8, 52], [0.4, 1], Extrapolation.CLAMP) }],
  }))
  return (
    <View style={styles.action}>
      <Animated.View style={[styles.actionCircle, { backgroundColor: t.surfaceAlt }, style]}>
        <Icon name="arrow-undo" size={18} color={t.primary} />
      </Animated.View>
    </View>
  )
}

interface Props extends BodyProps {
  onReply: (m: Message) => void
  onMenu: (m: Message, layout: BubbleLayout) => void
}

export const MessageBubble = memo(function MessageBubble({ message, first, last, group, onReply, onMenu }: Props) {
  const mine = message.fromMe
  const swipe = useRef<SwipeableMethods>(null)
  const box = useRef<ComponentRef<typeof View>>(null)
  const a11y = `${mine ? 'You' : message.senderName}: ${message.text}. ${clockTime(message.at)}${mine ? `. ${message.status}` : ''}`

  return (
    <View style={[styles.row, { justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: first ? 8 : 2 }]}>
      <ReanimatedSwipeable
        ref={swipe}
        friction={1.6}
        overshootLeft={false}
        overshootRight={false}
        leftThreshold={56}
        dragOffsetFromLeft={14}
        renderLeftActions={(_p, translation) => <ReplyAction translation={translation} />}
        onSwipeableWillOpen={() => {
          onReply(message)
          swipe.current?.close()
        }}
        containerStyle={{ overflow: 'visible', maxWidth: '86%' }}
        childrenContainerStyle={{ overflow: 'visible' }}
      >
        <Pressable
          ref={box}
          delayLongPress={260}
          accessibilityLabel={a11y}
          accessibilityHint="Swipe right to reply. Long press for more."
          accessibilityActions={[{ name: 'reply', label: 'Reply' }]}
          onAccessibilityAction={() => onReply(message)}
          onLongPress={() => {
            haptic.medium()
            box.current?.measureInWindow((x, y, width, height) => onMenu(message, { x, y, width, height }))
          }}
        >
          <BubbleBody message={message} first={first} last={last} group={group} />
        </Pressable>
      </ReanimatedSwipeable>
    </View>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 10 },
  bubble: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 6, minWidth: 64 },
  content: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'flex-end', columnGap: 8 },
  text: { fontSize: 16, lineHeight: 22, flexShrink: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 1, marginLeft: 'auto' },
  quote: { borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6, gap: 1 },
  action: { width: 56, justifyContent: 'center', alignItems: 'center' },
  actionCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
})

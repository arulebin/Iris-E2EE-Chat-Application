import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type { ChatSummary } from '@/state/services'
import { haptic } from '../lib/haptics'
import { listTime, previewText } from '../lib/timeline'
import { useTheme } from '../theme'
import { Avatar } from './Avatar'
import { Badge } from './Badge'
import { Icon } from './Icon'
import { Text } from './Text'
import { Ticks } from './Ticks'

interface Props {
  chat: ChatSummary
  onPress: (chat: ChatSummary) => void
  onLongPress: (chat: ChatSummary) => void
}

export const ChatRow = memo(function ChatRow({ chat, onPress, onLongPress }: Props) {
  const t = useTheme()
  const last = chat.lastMessage
  const unread = chat.unread > 0
  const preview = chat.typing ? null : last ? (chat.kind === 'group' && !last.fromMe ? `${last.senderName.split(' ')[0]}: ` : '') + previewText(last.text) : 'No messages yet'
  const a11y = `${chat.title}. ${unread ? `${chat.unread} unread. ` : ''}${chat.typing ? 'Typing. ' : last ? `Last message: ${last.text}. ` : ''}${chat.pinned ? 'Pinned. ' : ''}${chat.muted ? 'Muted.' : ''}`

  return (
    <Pressable
      onPress={() => onPress(chat)}
      onLongPress={() => {
        haptic.medium()
        onLongPress(chat)
      }}
      delayLongPress={280}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the conversation. Long press for more actions."
      android_ripple={{ color: t.hairline }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surfaceAlt : 'transparent' }]}
    >
      <Avatar name={chat.title} seed={chat.id} size={54} online={chat.online} group={chat.kind === 'group'} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text variant="bodyStrong" weight={unread ? 'bold' : 'semibold'} numberOfLines={1} style={{ flex: 1 }}>
            {chat.title}
          </Text>
          {last ? (
            <Text variant="caption" color={unread && !chat.muted ? t.primary : t.muted}>
              {listTime(last.at)}
            </Text>
          ) : null}
        </View>
        <View style={styles.line}>
          <View style={styles.previewWrap}>
            {last?.fromMe && !chat.typing ? <Ticks status={last.status} size={16} /> : null}
            {chat.typing ? (
              <Text variant="small" tone="primary" weight="semibold" numberOfLines={1}>
                typing…
              </Text>
            ) : (
              <Text variant="small" tone="muted" weight={unread ? 'semibold' : 'regular'} numberOfLines={1} style={{ flex: 1 }}>
                {preview}
              </Text>
            )}
          </View>
          <View style={styles.meta}>
            {chat.muted ? <Icon name="notifications-off" size={14} color={t.muted} /> : null}
            {chat.pinned ? <Icon name="pin" size={14} color={t.muted} /> : null}
            <Badge count={chat.unread} muted={chat.muted} />
          </View>
        </View>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10, minHeight: 74 },
  body: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
})

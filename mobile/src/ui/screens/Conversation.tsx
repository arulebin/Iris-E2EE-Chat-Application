import { FlashList, type FlashListRef } from '@shopify/flash-list'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { startCall } from '@/calls'
import { openCamera, openDocumentPicker, openPicker } from '@/media'
import { useChat, useContact, useMessages, useServices } from '@/state/hooks'
import { peekRuntime } from '@/state/real'
import type { Message, ReplyRef } from '@/state/services'
import { Avatar } from '../components/Avatar'
import { Badge } from '../components/Badge'
import { IconButton } from '../components/Header'
import { ListItem } from '../components/ListItem'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { Text } from '../components/Text'
import { Ticks, statusLabel } from '../components/Ticks'
import { useToast } from '../components/Toast'
import { Composer } from '../components/chat/Composer'
import { MessageContextMenu, type MenuAction, type MenuTarget } from '../components/chat/MessageContextMenu'
import { MessageBubble, type BubbleLayout } from '../components/chat/MessageBubble'
import { TypingIndicator } from '../components/chat/TypingIndicator'
import { haptic } from '../lib/haptics'
import { buildTimeline, clockTime, lastSeenLabel, type TimelineItem } from '../lib/timeline'
import { radius, useTheme } from '../theme'

const AT_BOTTOM = 160

/** Shared by direct and group conversations. */
export function Conversation({ chatId }: { chatId: string }) {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const services = useServices()
  const toast = useToast()
  const chatQ = useChat(chatId)
  const msgQ = useMessages(chatId)
  const chat = chatQ.data
  const group = chat?.kind === 'group'
  const peerQ = useContact(chat?.peerId)
  const messages = msgQ.data

  const list = useRef<FlashListRef<TimelineItem>>(null)
  const atBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [newBelow, setNewBelow] = useState(0)
  const [reply, setReply] = useState<ReplyRef | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [info, setInfo] = useState<Message | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const topId = useRef<string | undefined>(undefined)

  const items = useMemo(() => buildTimeline(messages ?? [], { typing: chat?.typing }), [messages, chat?.typing])
  const flags = useRef(new Map<string, { first: boolean; last: boolean }>())

  // Track incoming messages while the user is reading history.
  useEffect(() => {
    const top = messages?.[0]
    if (!top) return
    if (topId.current && top.id !== topId.current && !top.fromMe && !atBottom.current) setNewBelow(n => n + 1)
    if (topId.current && top.id !== topId.current && top.fromMe) list.current?.scrollToOffset({ offset: 0, animated: true })
    topId.current = top.id
  }, [messages])

  // Tell the runtime which chat is on screen (read receipts on arrival, server metadata refresh).
  useEffect(() => {
    peekRuntime()?.setOpenChat(chatId)
    return () => peekRuntime()?.setOpenChat(null)
  }, [chatId])

  const attach = useCallback(
    (kind: 'gallery' | 'camera' | 'document') => {
      setAttachOpen(false)
      // System pickers / camera leave the app briefly: do not let that trip the app lock.
      peekRuntime()?.suppressLock()
      const opts = { allowViewOnce: !group }
      if (kind === 'gallery') openPicker(chatId, opts)
      else if (kind === 'camera') openCamera(chatId, opts)
      else openDocumentPicker(chatId, opts).catch(() => toast.show('Could not open files', 'error'))
    },
    [chatId, group, toast],
  )

  const call = useCallback(
    (mode: 'audio' | 'video') => {
      if (!chat?.peerId) return
      haptic.tap()
      peekRuntime()?.suppressLock(30_000) // mic / camera permission dialogs
      startCall(chat.peerId, mode).catch((e: unknown) => toast.show((e as Error)?.message || 'Could not start the call', 'error'))
    },
    [chat?.peerId, toast],
  )

  // Mark read while the conversation is open and the user is at the bottom.
  useEffect(() => {
    if (chat && chat.unread > 0 && atBottom.current) services.chats.markRead(chatId)
  }, [chat?.unread, chatId, services, chat])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y
      const bottom = y < AT_BOTTOM
      if (bottom !== atBottom.current) {
        atBottom.current = bottom
        setShowJump(!bottom)
        if (bottom) {
          setNewBelow(0)
          services.chats.markRead(chatId)
        }
      }
    },
    [chatId, services],
  )

  const jump = () => {
    haptic.tap()
    list.current?.scrollToOffset({ offset: 0, animated: true })
  }

  const onReply = useCallback((m: Message) => {
    haptic.select()
    setReply({ id: m.id, senderName: m.fromMe ? 'You' : m.senderName, text: m.text })
  }, [])
  const onMenu = useCallback(
    (m: Message, layout: BubbleLayout) => {
      const f = flags.current.get(m.id) ?? { first: true, last: true }
      setMenu({ message: m, layout, first: f.first, last: f.last, group: !!group })
    },
    [group],
  )

  const onAction = useCallback(
    async (a: MenuAction, m: Message) => {
      if (a === 'reply') onReply(m)
      else if (a === 'copy') {
        await Clipboard.setStringAsync(m.text)
        toast.show('Copied', 'success')
      } else if (a === 'info') setInfo(m)
      else {
        haptic.warning()
        await services.chats.deleteForMe(chatId, m.id)
        toast.show('Message deleted for you')
      }
    },
    [chatId, onReply, services, toast],
  )

  const send = useCallback(
    (text: string) => {
      services.chats.send(chatId, text, reply?.id).catch((e: unknown) => {
        const msg = e instanceof Error && e.message.trim() ? e.message.trim() : ''
        toast.show(msg || 'Could not send message', 'error')
      })
      setReply(null)
    },
    [chatId, reply, services, toast],
  )

  const renderItem = useCallback(
    ({ item }: { item: TimelineItem }) => {
      if (item.type === 'typing') return <TypingIndicator name={chat?.title} />
      if (item.type === 'date')
        return (
          <View style={styles.dateWrap}>
            <View style={[styles.datePill, { backgroundColor: t.surfaceAlt }]}>
              <Text variant="caption" weight="semibold" tone="muted">
                {item.label}
              </Text>
            </View>
          </View>
        )
      flags.current.set(item.message.id, { first: item.first, last: item.last })
      return <MessageBubble message={item.message} first={item.first} last={item.last} group={!!group} onReply={onReply} onMenu={onMenu} />
    },
    [chat?.title, group, onReply, onMenu, t.surfaceAlt],
  )

  const subtitle = chat?.typing
    ? 'typing…'
    : group
      ? `${chat?.memberCount ?? ''} members`
      : chat?.online
        ? 'online'
        : lastSeenLabel(peerQ.data?.lastSeen)

  return (
    <View style={[styles.root, { backgroundColor: t.chatBg }]}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: t.bg, borderBottomColor: t.hairline }]}>
        <View style={styles.headerRow}>
          <IconButton name="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Pressable
            style={styles.headerMain}
            onPress={() => (group ? router.push({ pathname: '/group/[id]', params: { id: chatId } }) : chat?.peerId && router.push({ pathname: '/safety/[id]', params: { id: chat.peerId } }))}
            accessibilityRole="button"
            accessibilityLabel={`${chat?.title ?? 'Chat'}, ${subtitle}`}
            accessibilityHint={group ? 'Opens group info' : 'Opens safety number'}
          >
            <Avatar name={chat?.title ?? '…'} seed={chatId} size={38} online={chat?.online} group={group} />
            <View style={{ flex: 1 }}>
              <Text weight="bold" numberOfLines={1}>
                {chat?.title ?? ''}
              </Text>
              <Text variant="caption" color={chat?.typing || chat?.online ? t.primary : t.muted} numberOfLines={1} weight={chat?.typing ? 'semibold' : 'medium'}>
                {subtitle}
              </Text>
            </View>
          </Pressable>
          {!group && chat?.peerId ? (
            <IconButton
              name={peerQ.data?.verified ? 'shield-checkmark' : 'shield-outline'}
              color={peerQ.data?.verified ? t.success : t.ink}
              label="Safety number"
              onPress={() => router.push({ pathname: '/safety/[id]', params: { id: chat.peerId! } })}
            />
          ) : null}
          {!group && chat?.peerId ? (
            <>
              <IconButton name="videocam-outline" label="Video call" onPress={() => call('video')} />
              <IconButton name="call-outline" label="Voice call" onPress={() => call('audio')} />
            </>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <FlashList
            ref={list}
            data={items}
            inverted
            keyExtractor={i => i.key}
            getItemType={i => i.type}
            renderItem={renderItem}
            onScroll={onScroll}
            scrollEventThrottle={32}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingVertical: 8 }}
            ListFooterComponent={
              messages && messages.length === 0 ? (
                <View style={styles.encNotice}>
                  <Icon name="lock-closed" size={14} color={t.muted} />
                  <Text variant="caption" tone="muted" align="center" style={{ flex: 1 }}>
                    Messages are end-to-end encrypted. Say hello.
                  </Text>
                </View>
              ) : (
                <View style={[styles.encNotice, { backgroundColor: t.surfaceAlt }]}>
                  <Icon name="lock-closed" size={14} color={t.muted} />
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                    Messages are end-to-end encrypted. Only you and the people in this chat can read them.
                  </Text>
                </View>
              )
            }
          />
          {showJump && (
            <Animated.View entering={ZoomIn.duration(160)} exiting={ZoomOut.duration(120)} style={styles.jumpWrap} pointerEvents="box-none">
              <Pressable
                onPress={jump}
                accessibilityRole="button"
                accessibilityLabel={newBelow ? `Scroll to latest, ${newBelow} new messages` : 'Scroll to latest'}
                style={[styles.jump, { backgroundColor: t.surface, borderColor: t.hairline }]}
              >
                <Icon name="chevron-down" size={22} color={t.ink} />
              </Pressable>
              {newBelow > 0 && (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.jumpBadge}>
                  <Badge count={newBelow} />
                </Animated.View>
              )}
            </Animated.View>
          )}
        </View>
        <Composer reply={reply} onCancelReply={() => setReply(null)} onSend={send} onTyping={v => services.chats.setTyping(chatId, v)} onAttach={() => setAttachOpen(true)} placeholder={group ? 'Message the group' : 'Message'} />
      </KeyboardAvoidingView>

      <MessageContextMenu target={menu} onClose={() => setMenu(null)} onAction={onAction} />

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Send">
        <View style={{ paddingBottom: insets.bottom + 8 }}>
          <ListItem icon="images" title="Photos & videos" onPress={() => attach('gallery')} />
          <ListItem icon="camera" title="Camera" onPress={() => attach('camera')} />
          <ListItem icon="document" title="Document" onPress={() => attach('document')} />
        </View>
      </Sheet>

      <Sheet visible={!!info} onClose={() => setInfo(null)} title="Message info">
        {info ? (
          <View style={styles.info}>
            <Text tone="soft" numberOfLines={4}>
              {info.text}
            </Text>
            <View style={styles.infoRow}>
              <Text tone="muted">Sent</Text>
              <Text weight="semibold">{new Date(info.at).toLocaleDateString()} {clockTime(info.at)}</Text>
            </View>
            {info.fromMe ? (
              <View style={styles.infoRow}>
                <Text tone="muted">Status</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ticks status={info.status} />
                  <Text weight="semibold">{statusLabel(info.status)}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.infoRow}>
                <Text tone="muted">From</Text>
                <Text weight="semibold">{info.senderName}</Text>
              </View>
            )}
          </View>
        ) : null}
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingRight: 4 },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  dateWrap: { alignItems: 'center', marginVertical: 10 },
  datePill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill },
  encNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginVertical: 14, padding: 10, borderRadius: 12 },
  jumpWrap: { position: 'absolute', right: 14, bottom: 12 },
  jump: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  jumpBadge: { position: 'absolute', top: -10, right: -4 },
  info: { padding: 20, gap: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
})

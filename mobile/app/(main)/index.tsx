import { FlashList } from '@shopify/flash-list'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useChats, useProfile, useRequests, useServices } from '@/state/hooks'
import type { ChatSummary } from '@/state/services'
import { Avatar } from '@/ui/components/Avatar'
import { ChatRow } from '@/ui/components/ChatRow'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/Header'
import { Icon } from '@/ui/components/Icon'
import { ActionSheet, type SheetAction } from '@/ui/components/Sheet'
import { Text } from '@/ui/components/Text'
import { useToast } from '@/ui/components/Toast'
import { haptic } from '@/ui/lib/haptics'
import { gradient, fonts, useTheme } from '@/ui/theme'

type Tab = 'chats' | 'groups'

export default function ChatListScreen() {
  const t = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const services = useServices()
  const toast = useToast()
  const chatsQ = useChats()
  const reqQ = useRequests()
  const profileQ = useProfile()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [menuChat, setMenuChat] = useState<ChatSummary | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('chats')
  const pager = useRef<Animated.ScrollView>(null)
  const scrollX = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler(e => {
    scrollX.value = e.contentOffset.x
  })

  const all = chatsQ.data ?? []
  const q = query.trim().toLowerCase()
  const match = (c: ChatSummary) => !q || c.title.toLowerCase().includes(q) || (c.lastMessage?.text.toLowerCase().includes(q) ?? false)
  const direct = useMemo(() => all.filter(c => c.kind === 'direct' && !c.archived && match(c)), [all, q])
  const groups = useMemo(() => all.filter(c => c.kind === 'group' && !c.archived && match(c)), [all, q])
  const archivedCount = all.filter(c => c.archived).length
  const groupUnread = all.filter(c => c.kind === 'group' && !c.muted).reduce((n, c) => n + c.unread, 0)
  const directUnread = all.filter(c => c.kind === 'direct' && !c.muted).reduce((n, c) => n + c.unread, 0)

  const openChat = useCallback((c: ChatSummary) => router.push({ pathname: '/chat/[id]', params: { id: c.id } }), [router])
  const longPress = useCallback((c: ChatSummary) => {
    setMenuChat(c)
    setMenuOpen(true)
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    haptic.tap()
    try {
      await services.chats.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [services])

  const goTab = (next: Tab) => {
    haptic.select()
    setTab(next)
    pager.current?.scrollTo({ x: next === 'chats' ? 0 : width, animated: true })
  }

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(scrollX.value, [0, width], [0, (width - 32) / 2]) }] }))
  const fabScale = useSharedValue(1)
  const fabStyle = useAnimatedStyle(() => ({ transform: [{ scale: fabScale.value }] }))

  const actions: SheetAction[] = menuChat
    ? [
        { label: menuChat.pinned ? 'Unpin' : 'Pin to top', icon: menuChat.pinned ? 'pin-outline' : 'pin', onPress: () => services.chats.setPinned(menuChat.id, !menuChat.pinned) },
        { label: menuChat.muted ? 'Unmute' : 'Mute notifications', icon: menuChat.muted ? 'notifications' : 'notifications-off', onPress: () => services.chats.setMuted(menuChat.id, !menuChat.muted) },
        { label: 'Archive', icon: 'archive', onPress: () => { services.chats.setArchived(menuChat.id, true); toast.show('Chat archived', 'success') } },
        ...(menuChat.unread ? [{ label: 'Mark as read', icon: 'checkmark-done' as const, onPress: () => services.chats.markRead(menuChat.id) }] : []),
      ]
    : []

  const renderItem = useCallback(({ item }: { item: ChatSummary }) => <ChatRow chat={item} onPress={openChat} onLongPress={longPress} />, [openChat, longPress])

  const page = (data: ChatSummary[], kind: Tab) => (
    <View style={{ width }}>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={c => c.id}
        refreshing={refreshing}
        onRefresh={refresh}
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          kind === 'chats' && archivedCount > 0 && !q ? (
            <Pressable
              onPress={() => toast.show(`${archivedCount} archived chat${archivedCount > 1 ? 's' : ''} (view coming soon)`)}
              style={styles.archived}
              accessibilityRole="button"
              accessibilityLabel={`Archived, ${archivedCount} chats`}
            >
              <Icon name="archive-outline" size={20} color={t.muted} />
              <Text weight="semibold" tone="muted" style={{ flex: 1 }}>
                Archived
              </Text>
              <Text tone="muted">{archivedCount}</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          chatsQ.loading ? null : q ? (
            <EmptyState icon="search" title="No results" body={`Nothing matches "${query}".`} />
          ) : kind === 'chats' ? (
            <EmptyState icon="chatbubbles-outline" title="No chats yet" body="Add a friend with their invite code, then say hello." />
          ) : (
            <EmptyState icon="people-outline" title="No groups yet" body="Create a group to chat with several friends at once." />
          )
        }
      />
    </View>
  )

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={styles.top}>
        {searching ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={[styles.search, { backgroundColor: t.surfaceAlt }]}>
            <Icon name="search" size={18} color={t.muted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search chats"
              placeholderTextColor={t.muted}
              style={[styles.searchInput, { color: t.ink, fontFamily: fonts.medium }]}
              returnKeyType="search"
              accessibilityLabel="Search chats"
            />
            <Pressable
              onPress={() => {
                setQuery('')
                setSearching(false)
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Icon name="close-circle" size={20} color={t.muted} />
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(160)} style={styles.titleRow}>
            <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
              Iris
            </Text>
            <IconButton name="search" label="Search" onPress={() => setSearching(true)} />
            <IconButton name="people-outline" label="Friend requests" badge={reqQ.data?.length} onPress={() => router.push('/requests')} />
            <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={6} style={{ marginLeft: 4 }}>
              <Avatar name={profileQ.data?.displayName ?? 'Me'} size={34} brand />
            </Pressable>
          </Animated.View>
        )}
      </View>

      <View style={[styles.tabs, { backgroundColor: t.surfaceAlt }]} accessibilityRole="tablist">
        <Animated.View style={[styles.indicator, { backgroundColor: t.surface, width: (width - 32 - 8) / 2 }, indicator]} />
        {(['chats', 'groups'] as const).map(k => (
          <Pressable key={k} style={styles.tab} onPress={() => goTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} accessibilityLabel={k === 'chats' ? 'Chats' : 'Groups'}>
            <Text weight="bold" color={tab === k ? t.ink : t.muted}>
              {k === 'chats' ? 'Chats' : 'Groups'}
            </Text>
            {(k === 'chats' ? directUnread : groupUnread) > 0 && <View style={[styles.dot, { backgroundColor: t.primary }]} />}
          </Pressable>
        ))}
      </View>

      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={e => {
          const next: Tab = e.nativeEvent.contentOffset.x > width / 2 ? 'groups' : 'chats'
          if (next !== tab) {
            haptic.select()
            setTab(next)
          }
        }}
        style={{ flex: 1 }}
      >
        {page(direct, 'chats')}
        {page(groups, 'groups')}
      </Animated.ScrollView>

      <Animated.View style={[styles.fab, { bottom: insets.bottom + 20 }, fabStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tab === 'chats' ? 'New chat' : 'New group'}
          onPressIn={() => (fabScale.value = withSpring(0.92))}
          onPressOut={() => (fabScale.value = withSpring(1))}
          onPress={() => {
            haptic.medium()
            router.push(tab === 'chats' ? '/new-chat' : '/new-group')
          }}
        >
          <LinearGradient colors={[...gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
            <Icon name={tab === 'chats' ? 'chatbubble-ellipses' : 'people'} size={26} color="#fff" />
          </LinearGradient>
        </Pressable>
      </Animated.View>

      <ActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={menuChat?.title} actions={actions} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { minHeight: 60, justifyContent: 'center', paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, borderRadius: 22, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 6, borderRadius: 14, padding: 4, height: 44 },
  indicator: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 11, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  archived: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  fab: { position: 'absolute', right: 20, shadowColor: '#5b5bd6', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  fabInner: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
})

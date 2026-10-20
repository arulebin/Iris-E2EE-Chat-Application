import { BlurView } from 'expo-blur'
import { useEffect } from 'react'
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Message } from '@/state/services'
import { haptic } from '../../lib/haptics'
import { radius, useTheme } from '../../theme'
import { Icon, type IconName } from '../Icon'
import { Text } from '../Text'
import { BubbleBody, type BubbleLayout } from './MessageBubble'

export type MenuAction = 'reply' | 'copy' | 'info' | 'delete'

const ITEMS: Array<{ id: MenuAction; label: string; icon: IconName; destructive?: boolean }> = [
  { id: 'reply', label: 'Reply', icon: 'arrow-undo-outline' },
  { id: 'copy', label: 'Copy', icon: 'copy-outline' },
  { id: 'info', label: 'Info', icon: 'information-circle-outline' },
  { id: 'delete', label: 'Delete for me', icon: 'trash-outline', destructive: true },
]
const ITEM_H = 50
const MENU_W = 220

export interface MenuTarget {
  message: Message
  layout: BubbleLayout
  first: boolean
  last: boolean
  group: boolean
}

/** Long-press menu: blurred backdrop, a lifted copy of the bubble and an action card. */
export function MessageContextMenu({ target, onClose, onAction }: { target: MenuTarget | null; onClose: () => void; onAction: (a: MenuAction, m: Message) => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { height: H, width: W } = useWindowDimensions()
  const lift = useSharedValue(0)

  useEffect(() => {
    lift.value = target ? withSpring(1, { damping: 16, stiffness: 220 }) : 0
  }, [target, lift])

  const bubbleAnim = useAnimatedStyle(() => ({ transform: [{ scale: 0.97 + 0.03 * lift.value }] }))
  const menuAnim = useAnimatedStyle(() => ({ opacity: lift.value, transform: [{ scale: 0.85 + 0.15 * lift.value }, { translateY: (1 - lift.value) * -8 }] }))

  if (!target) return null
  const { message, layout } = target
  const menuH = ITEMS.length * ITEM_H + 12
  const maxBottom = H - insets.bottom - 16
  let bubbleTop = layout.y
  // keep the lifted bubble fully on screen
  bubbleTop = Math.min(Math.max(bubbleTop, insets.top + 8), maxBottom - layout.height - menuH - 12)
  bubbleTop = Math.max(bubbleTop, insets.top + 8)
  const menuTop = Math.min(bubbleTop + layout.height + 10, maxBottom - menuH)
  const menuLeft = message.fromMe ? Math.max(12, Math.min(layout.x + layout.width - MENU_W, W - MENU_W - 12)) : Math.max(12, Math.min(layout.x, W - MENU_W - 12))

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
        <BlurView intensity={45} tint={t.isDark ? 'dark' : 'light'} experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay, opacity: 0.55 }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: layout.x, top: bubbleTop, width: layout.width }, bubbleAnim]}>
        <BubbleBody message={message} first={target.first} last={target.last} group={target.group} />
      </Animated.View>

      <Animated.View
        style={[styles.menu, { left: menuLeft, top: menuTop, width: MENU_W, backgroundColor: t.surface, borderColor: t.hairline }, menuAnim]}
        accessibilityRole="menu"
      >
        {ITEMS.map(item => (
          <Pressable
            key={item.id}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            android_ripple={{ color: t.hairline }}
            onPress={() => {
              haptic.tap()
              onClose()
              setTimeout(() => onAction(item.id, message), 120)
            }}
            style={({ pressed }) => [styles.item, { backgroundColor: pressed ? t.surfaceAlt : 'transparent' }]}
          >
            <Text weight="semibold" color={item.destructive ? t.danger : t.ink} style={{ flex: 1 }}>
              {item.label}
            </Text>
            <Icon name={item.icon} size={20} color={item.destructive ? t.danger : t.ink} />
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    borderRadius: radius.lg,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
    overflow: 'hidden',
  },
  item: { height: ITEM_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 },
})

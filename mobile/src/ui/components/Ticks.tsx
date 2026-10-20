import type { MessageStatus } from '@/state/services'
import { useTheme } from '../theme'
import { Icon } from './Icon'

const LABEL: Record<MessageStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed to send',
}

/** WhatsApp style receipt: clock, ✓ sent, ✓✓ delivered, blue ✓✓ read. */
export function Ticks({ status, size = 16, onBubble }: { status: MessageStatus; size?: number; onBubble?: boolean }) {
  const t = useTheme()
  const base = onBubble ? t.bubbleOutMuted : t.tick
  const read = onBubble ? '#9fe0ff' : t.tickRead
  const name = status === 'sending' ? 'time-outline' : status === 'sent' ? 'checkmark' : status === 'failed' ? 'alert-circle' : 'checkmark-done'
  const color = status === 'read' ? read : status === 'failed' ? t.danger : base
  return <Icon name={name} size={size} color={color} />
}

export const statusLabel = (s: MessageStatus) => LABEL[s]

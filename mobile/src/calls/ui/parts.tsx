import { useEffect, useState, type ReactNode } from 'react'
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { RTCView } from 'react-native-webrtc'
import type { Quality } from '../quality'
import type { StreamLike } from '../types'

export const CALL_BG = '#0b0d12'
export const ACCENT = '#7C5CFF'
export const GREEN = '#22c55e'
export const RED = '#e5484d'

export type PeerProfile = { name: string; avatarUrl?: string }

// ── video ──────────────────────────────────────────────────────

/** RTCView wrapper. Keyed by stream so a re-created stream (track added mid-call) rebinds the renderer. */
export function VideoView({ stream, mirror, style, zOrder = 0 }: {
  stream: StreamLike | null
  mirror?: boolean
  style?: StyleProp<ViewStyle>
  zOrder?: number
}) {
  const url = stream ? (stream as unknown as { toURL(): string }).toURL() : null
  if (!url) return null
  return <RTCView key={url} streamURL={url} objectFit="cover" mirror={mirror} zOrder={zOrder} style={style} />
}

export const hasVideo = (s: StreamLike | null) => !!s?.getVideoTracks().some((t) => t.readyState === 'live')

// ── avatar ─────────────────────────────────────────────────────

export function Avatar({ name, uri, size = 96 }: { name: string; uri?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const initials = (name.trim()[0] ?? '?').toUpperCase()
  if (uri && !failed) {
    return <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: size / 2 }} />
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '600' }}>{initials}</Text>
    </View>
  )
}

// ── controls ───────────────────────────────────────────────────

export function RoundButton({ label, onPress, active, danger, success, size = 56, children }: {
  label: string
  onPress: () => void
  active?: boolean
  danger?: boolean
  success?: boolean
  size?: number
  children: ReactNode
}) {
  const bg = danger ? RED : success ? GREEN : active ? '#fff' : 'rgba(255,255,255,0.16)'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        pressed && { transform: [{ scale: 0.94 }], opacity: 0.9 },
      ]}
    >
      {children}
    </Pressable>
  )
}

export function QualityBars({ quality }: { quality: Quality }) {
  if (quality === 'unknown') return null
  const level = quality === 'good' ? 3 : quality === 'fair' ? 2 : 1
  const color = quality === 'good' ? GREEN : quality === 'fair' ? '#f5a524' : RED
  return (
    <View style={styles.bars} accessibilityRole="image" accessibilityLabel={`Connection ${quality}`}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={{ width: 4, height: 4 + i * 3, borderRadius: 1.5, backgroundColor: i <= level ? color : 'rgba(255,255,255,0.28)' }} />
      ))}
    </View>
  )
}

export function Chip({ children }: { children: ReactNode }) {
  return <View style={styles.chip}>{children}</View>
}

export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return startedAt === null ? 0 : Math.max(0, (now - startedAt) / 1000)
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)',
  },
})

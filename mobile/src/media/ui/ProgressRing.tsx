import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { ringDash } from '../helpers'

interface Props {
  size: number
  stroke?: number
  /** 0..1. `undefined` renders a static partial arc (indeterminate look). */
  progress?: number
  color?: string
  track?: string
  children?: ReactNode
}

/** SVG progress ring, starts at 12 o'clock. Used for recording, uploads and downloads. */
export function ProgressRing({ size, stroke = 4, progress, color = '#fff', track = 'rgba(255,255,255,0.28)', children }: Props) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const { dasharray, dashoffset } = ringDash(c, progress ?? 0.25)
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={dasharray}
          strokeDashoffset={dashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } })

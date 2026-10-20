import Svg, { Line, Path, Polygon, Rect } from 'react-native-svg'

type IconProps = { size?: number; color?: string; strokeWidth?: number }

function Base({ size = 24, color = '#fff', strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  )
}

const PHONE = 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'

export const PhoneIcon = (p: IconProps & { hangup?: boolean }) => (
  <Base {...p} strokeWidth={p.strokeWidth ?? 0}>
    <Path d={PHONE} fill={p.color ?? '#fff'} stroke="none" rotation={p.hangup ? 135 : 0} origin="12, 12" />
  </Base>
)

export const MicIcon = ({ off, ...p }: IconProps & { off?: boolean }) => (
  <Base {...p}>
    <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <Line x1="12" y1="19" x2="12" y2="23" />
    <Line x1="8" y1="23" x2="16" y2="23" />
    {off && <Line x1="2" y1="2" x2="22" y2="22" />}
  </Base>
)

export const CamIcon = ({ off, ...p }: IconProps & { off?: boolean }) => (
  <Base {...p}>
    {off ? (
      <>
        <Path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
        <Line x1="1" y1="1" x2="23" y2="23" />
      </>
    ) : (
      <>
        <Polygon points="23 7 16 12 23 17 23 7" />
        <Rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </>
    )}
  </Base>
)

export const FlipIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M23 4v6h-6" />
    <Path d="M1 20v-6h6" />
    <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </Base>
)

export const SpeakerIcon = ({ on = true, ...p }: IconProps & { on?: boolean }) => (
  <Base {...p}>
    <Polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {on ? <Path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /> : <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" />}
  </Base>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M6 9l6 6 6-6" />
  </Base>
)

export const LockIcon = (p: IconProps) => (
  <Base {...p}>
    <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Base>
)

export const MessageIcon = (p: IconProps) => (
  <Base {...p}>
    <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Base>
)

export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </Base>
)

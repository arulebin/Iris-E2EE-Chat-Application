import { Image, type ImageStyle, type StyleProp } from 'react-native'

// The Iris rings, taken from the splash artwork (transparent-safe on both themes).
export function IrisMark({ size = 96, dark = false, style }: { size?: number; dark?: boolean; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={dark ? require('../../assets/splash-icon-dark.png') : require('../../assets/splash-icon.png')}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  )
}

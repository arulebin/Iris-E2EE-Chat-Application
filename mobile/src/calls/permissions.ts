import { PermissionsAndroid, Platform, type Permission } from 'react-native'
import type { CallMode } from './types'

/**
 * Runtime permissions a call needs. Microphone is mandatory (and camera for video);
 * Bluetooth (headset routing) and notifications (incoming-call UI) are best effort.
 * Returns false only if a mandatory permission was refused.
 */
export async function ensureCallPermissions(mode: CallMode): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const P = PermissionsAndroid.PERMISSIONS
  const required: Permission[] = [P.RECORD_AUDIO]
  if (mode === 'video') required.push(P.CAMERA)
  const optional: Permission[] = []
  if (Platform.Version >= 31) optional.push(P.BLUETOOTH_CONNECT)
  if (Platform.Version >= 33) optional.push(P.POST_NOTIFICATIONS)

  const res = await PermissionsAndroid.requestMultiple([...required, ...optional])
  return required.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED)
}

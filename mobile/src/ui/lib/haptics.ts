import * as Haptics from 'expo-haptics'

let enabled = true
export function setHapticsEnabled(v: boolean) {
  enabled = v
}

const safe = (fn: () => Promise<void>) => {
  if (enabled) fn().catch(() => {})
}

/** Thin, fire-and-forget wrapper around expo-haptics that honours the in-app setting. */
export const haptic = {
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  select: () => safe(() => Haptics.selectionAsync()),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
}

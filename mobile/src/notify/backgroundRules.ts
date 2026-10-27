/**
 * Vendors whose Android builds stop push delivery to an app that is not on their "Autostart" / "No restrictions"
 * list (MIUI / HyperOS, ColorOS / OxygenOS, Funtouch / OriginOS, EMUI / MagicOS). Stock Android and
 * AOSP-based ROMs deliver high-priority FCM to Iris without any setting.
 */
export const RESTRICTIVE_VENDORS = ['xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'huawei', 'honor']

export type BackgroundStatus = {
  manufacturer: string
  ignoringBatteryOptimizations: boolean
  hasAutostartSettings: boolean
}

/** Ask once, only on those vendors, only with notifications on and only if Iris is not already exempt. */
export function backgroundPromptNeeded(o: { status: BackgroundStatus | null; notificationsOn: boolean; alreadyAsked: boolean }): boolean {
  if (!o.status || !o.notificationsOn || o.alreadyAsked) return false
  if (!RESTRICTIVE_VENDORS.includes(o.status.manufacturer.toLowerCase())) return false
  return !o.status.ignoringBatteryOptimizations || o.status.hasAutostartSettings
}

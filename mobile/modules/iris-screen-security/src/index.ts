import { requireOptionalNativeModule } from 'expo-modules-core'

type Native = { setSecure(enabled: boolean): Promise<void>; isSecure(): boolean }
const native = requireOptionalNativeModule<Native>('IrisScreenSecurity')

/** FLAG_SECURE is on by default natively. Toggle only for screens that must be capturable. */
export async function setScreenSecure(enabled: boolean): Promise<void> {
  await native?.setSecure(enabled)
}
export function isScreenSecure(): boolean {
  return native?.isSecure() ?? false
}

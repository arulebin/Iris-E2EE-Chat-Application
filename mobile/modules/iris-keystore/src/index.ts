import { requireOptionalNativeModule } from 'expo-modules-core'

/** Raw native surface (base64 in/out). Use `createKeystoreWrapper` from mobile/src/platform. */
export type IrisKeystoreNative = {
  wrap(alias: string, dataB64: string): Promise<string>
  unwrap(alias: string, dataB64: string): Promise<string>
  reset(alias: string): Promise<void>
  hasKey(alias: string): Promise<boolean>
  securityLevel(alias: string): Promise<'strongbox' | 'tee' | 'hardware' | 'software' | 'unknown'>
  lockStatus(): Promise<'available' | 'none_enrolled' | 'unsupported'>
  lockAuthenticate(title: string, subtitle?: string | null): Promise<void>
  lockCreateKey(alias: string, timeoutSeconds: number): Promise<void>
  lockDeleteKey(alias: string): Promise<void>
  lockWrap(alias: string, dataB64: string): Promise<string>
  lockUnwrap(alias: string, dataB64: string): Promise<string>
}

export const IrisKeystore = requireOptionalNativeModule<IrisKeystoreNative>('IrisKeystore')

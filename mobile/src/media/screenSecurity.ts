/**
 * Screen-security hook (Android FLAG_SECURE / iOS capture shield). The platform agent implements the native side
 * and registers it once at startup:
 *
 *   setScreenSecurityAdapter({ acquire: () => NativeScreenSecurity.enable(), release: () => NativeScreenSecurity.disable() })
 *
 * Several surfaces can want protection at once (app lock setting + an open snap), so this is ref-counted:
 * the adapter's acquire() runs on the 0 -> 1 transition and release() on 1 -> 0.
 * Until an adapter is registered every call is a harmless no-op.
 */
export interface ScreenSecurityAdapter {
  acquire(): void | Promise<void>
  release(): void | Promise<void>
}

let adapter: ScreenSecurityAdapter | null = null
let holds = 0

export function setScreenSecurityAdapter(a: ScreenSecurityAdapter | null): void {
  adapter = a
  // Re-apply the current state to a freshly registered adapter.
  if (a && holds > 0) void Promise.resolve(a.acquire()).catch(warn)
}

function warn(e: unknown) {
  console.warn('[screen-security]', e)
}

export const screenSecurity = {
  /** Take a hold. Returns an idempotent release function; also usable as acquire()/release() pairs. */
  acquire(): () => void {
    holds++
    if (holds === 1 && adapter) void Promise.resolve(adapter.acquire()).catch(warn)
    let released = false
    return () => {
      if (released) return
      released = true
      screenSecurity.release()
    }
  },
  release(): void {
    if (holds === 0) return
    holds--
    if (holds === 0 && adapter) void Promise.resolve(adapter.release()).catch(warn)
  },
  get activeHolds(): number {
    return holds
  },
}

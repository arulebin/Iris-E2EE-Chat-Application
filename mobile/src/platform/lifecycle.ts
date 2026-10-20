/** "App foregrounded" / "network back" signals, abstracted so transport logic is testable. */
export interface Lifecycle {
  onForeground(cb: () => void): () => void
  onOnline(cb: () => void): () => void
}

export type AppStateLike = {
  addEventListener(type: 'change', cb: (s: string) => void): { remove(): void }
}
export type NetInfoLike = {
  addEventListener(cb: (s: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void): () => void
}

export function createLifecycle(appState: AppStateLike, netInfo: NetInfoLike): Lifecycle {
  return {
    onForeground(cb) {
      const sub = appState.addEventListener('change', s => {
        if (s === 'active') cb()
      })
      return () => sub.remove()
    },
    onOnline(cb) {
      let wasOnline: boolean | null = null
      return netInfo.addEventListener(s => {
        const online = !!s.isConnected && s.isInternetReachable !== false
        if (online && wasOnline !== true) cb() // offline -> online transition
        wasOnline = online
      })
    },
  }
}

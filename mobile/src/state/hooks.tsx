import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, Services, Session, Topic } from './services'
import { createMockServices } from './mock'
import { createRealServices } from './real'

/** Dev builds can run the UI on in-memory data with EXPO_PUBLIC_MOCK=1; everything else uses the real stack. */
export const USE_MOCK = process.env.EXPO_PUBLIC_MOCK === '1'

const ServicesContext = createContext<Services | null>(null)

/** Swap `services` for the real implementation when it exists; screens do not change. */
export function ServicesProvider({ services, children }: { services?: Services; children: ReactNode }) {
  const value = useMemo(() => services ?? (USE_MOCK ? createMockServices() : createRealServices()), [services])
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('ServicesProvider missing')
  return s
}

export interface Query<T> {
  data: T | undefined
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Load data once and refetch whenever one of `topics` fires on the service bus.
 * Keeps the previous data while refetching (no flashes). Out-of-order results are dropped.
 */
export function useQuery<T>(fetcher: (s: Services) => Promise<T>, topics: Topic[], deps: unknown[] = []): Query<T> {
  const services = useServices()
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: Error | null }>({
    data: undefined,
    loading: true,
    error: null,
  })
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const seq = useRef(0)
  const topicKey = topics.join('|')

  const run = useCallback(async () => {
    const mine = ++seq.current
    try {
      const data = await fetchRef.current(services)
      if (mine === seq.current) setState({ data, loading: false, error: null })
    } catch (e) {
      if (mine === seq.current) setState(p => ({ ...p, loading: false, error: e as Error }))
    }
  }, [services])

  useEffect(() => {
    setState(p => ({ ...p, loading: true }))
    run()
    const offs = topics.map(t => services.events.on(t, run))
    return () => {
      seq.current++
      offs.forEach(o => o())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, run, topicKey, ...deps])

  return { ...state, refetch: run }
}

// ── domain hooks ────────────────────────────────────────────────────────

/** `undefined` while loading, `null` when signed out. */
export function useSession(): Session | null | undefined {
  return useQuery(s => s.auth.getSession(), ['session']).data
}

export const useChats = () => useQuery(s => s.chats.list(), ['chats'])
export const useContacts = () => useQuery(s => s.contacts.list(), ['contacts'])
export const useRequests = () => useQuery(s => s.contacts.requests(), ['requests'])
export const useBlocked = () => useQuery(s => s.contacts.blocked(), ['contacts'])
export const useChat = (id: string) => useQuery(s => s.chats.get(id), ['chats', `typing:${id}`], [id])
export const useMessages = (id: string) => useQuery(s => s.chats.messages(id, { limit: 80 }), [`messages:${id}`], [id])
export const useProfile = () => useQuery(s => s.profile.get(), ['profile'])
export const usePrivacy = () => useQuery(s => s.privacy.get(), ['privacy'])
export const useGroup = (id: string) => useQuery(s => s.groups.get(id), [`group:${id}`, 'chats'], [id])
export const useSafety = (id: string) => useQuery(s => s.safety.get(id), [`safety:${id}`], [id])
export const useBackup = () => useQuery(s => s.backup.status(), ['backup'])
export const useDevices = () => useQuery(s => s.devices.list(), ['devices'])
export const useContact = (id: string | undefined) =>
  useQuery(async s => (id ? s.contacts.get(id) : null), ['contacts'], [id])

const DEFAULT_SETTINGS: AppSettings = { theme: 'system', screenSecurity: false, appLock: false, haptics: true, notifications: true }

/** Settings with an optimistic setter. Always returns a value (defaults until loaded). */
export function useSettings(): { settings: AppSettings; update: (patch: Partial<AppSettings>) => Promise<Error | null>; ready: boolean } {
  const services = useServices()
  const q = useQuery(s => s.settings.get(), ['settings'])
  const [local, setLocal] = useState<Partial<AppSettings>>({})
  useEffect(() => setLocal({}), [q.data])
  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      setLocal(p => ({ ...p, ...patch }))
      return services.settings.update(patch).then(
        () => null,
        (e: unknown) => {
          setLocal({})
          return e instanceof Error ? e : new Error(String(e))
        },
      )
    },
    [services],
  )
  return { settings: { ...DEFAULT_SETTINGS, ...q.data, ...local }, update, ready: !!q.data }
}

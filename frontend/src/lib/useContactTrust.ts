import { useEffect, useState } from 'react'
import { getTrust, subscribeTrust, type ContactTrust } from './fingerprint'

/** Live view of the pin/verification state for one contact. */
export function useContactTrust(owner: string | null, contact: string): ContactTrust | undefined {
  const [state, setState] = useState<{ id: string; trust: ContactTrust | undefined }>()
  const id = `${owner}:${contact}`

  useEffect(() => {
    if (!owner) return
    let cancelled = false
    getTrust(owner, contact).then(trust => {
      if (!cancelled) setState({ id: `${owner}:${contact}`, trust })
    })
    const unsubscribe = subscribeTrust((o, c, trust) => {
      if (o === owner && c === contact) setState({ id: `${o}:${c}`, trust })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [owner, contact])

  // Ignore state left over from the previous contact while the new one loads.
  return state?.id === id ? state.trust : undefined
}

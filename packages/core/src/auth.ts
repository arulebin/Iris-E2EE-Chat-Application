import { fromBase64 } from './crypto/bytes.ts'

// JWT payload peeking (no signature check: the server is the authority). Mirrors the
// old atob(token.split('.')[1]) + JSON.parse, including its latin-1 text handling.
function payload(token: string): Record<string, unknown> {
  const bytes = fromBase64(token.split('.')[1])
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return JSON.parse(s) as Record<string, unknown>
}

export function getUsername(token: string | null): string | null {
  if (!token) return null
  try {
    return payload(token).sub as string
  } catch {
    return null
  }
}

export function getTokenExpiryMs(token: string | null): number | null {
  if (!token) return null
  try {
    const exp = payload(token).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

export function isTokenExpired(token: string | null): boolean {
  const expiryMs = getTokenExpiryMs(token)
  return expiryMs !== null && expiryMs <= Date.now()
}

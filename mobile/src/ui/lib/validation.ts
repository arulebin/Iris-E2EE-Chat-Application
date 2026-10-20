/** Pure validation / formatting helpers (no React Native imports, unit-tested). */

export const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/

export type UsernameIssue = 'empty' | 'too-short' | 'too-long' | 'bad-chars' | null

/** Same rule as the backend: ^[A-Za-z0-9_]{3,32}$ */
export function usernameIssue(value: string): UsernameIssue {
  if (value.length === 0) return 'empty'
  if (!/^[A-Za-z0-9_]*$/.test(value)) return 'bad-chars'
  if (value.length < 3) return 'too-short'
  if (value.length > 32) return 'too-long'
  return null
}

export function usernameMessage(issue: UsernameIssue): string {
  switch (issue) {
    case 'empty':
      return '3 to 32 characters: letters, numbers and underscore.'
    case 'too-short':
      return 'At least 3 characters.'
    case 'too-long':
      return 'At most 32 characters.'
    case 'bad-chars':
      return 'Only letters, numbers and underscore.'
    default:
      return 'Looks good.'
  }
}

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value)
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4

/** Cheap heuristic for the signup meter (the real secret never leaves the device unhashed). */
export function passwordStrength(pw: string): PasswordStrength {
  if (pw.length < 8) return pw.length === 0 ? 0 : 1
  let score = 1
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(4, score) as PasswordStrength
}

export const STRENGTH_LABELS = ['', 'Too weak', 'Okay', 'Good', 'Strong'] as const

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Canonical invite code from typed text or a full invite URL; null if it can't be one. */
export function normalizeInviteCode(input: string): string | null {
  let s = input.trim()
  const at = s.indexOf('add=')
  if (at >= 0) s = s.slice(at + 4).split('&')[0]
  let out = ''
  for (let c of s.toUpperCase()) {
    if (c === '-' || c === ' ') continue
    if (c === 'O') c = '0'
    else if (c === 'I' || c === 'L') c = '1'
    if (!ALPHABET.includes(c)) return null
    out += c
  }
  return out.length === 10 ? out : null
}

export function formatInviteCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code
}

/** 60 digits -> 12 groups of 5, as shown on the safety number screen. */
export function groupSafetyDigits(digits: string): string[] {
  const out: string[] = []
  for (let i = 0; i < digits.length; i += 5) out.push(digits.slice(i, i + 5))
  return out
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return Array.from(parts[0])[0]!.toUpperCase()
  return (Array.from(parts[0]!)[0]! + Array.from(parts[parts.length - 1]!)[0]!).toUpperCase()
}

/** Stable small hash for deterministic colors. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

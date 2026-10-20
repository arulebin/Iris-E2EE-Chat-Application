import { describe, expect, it } from 'vitest'
import { formatInviteCode, inviteUrl, isLegacyShareId, normalizeInviteCode } from './invite'

describe('invite codes', () => {
  it('normalizes typed codes, typos and full links the same way the server does', () => {
    expect(normalizeInviteCode('abcde-o1234')).toBe('ABCDE01234')
    expect(normalizeInviteCode(' ABCDE IL234 ')).toBe('ABCDE11234')
    expect(normalizeInviteCode('https://iris-chat-web.vercel.app/?add=ABCDE-01234&utm=x')).toBe('ABCDE01234')
    expect(normalizeInviteCode('short')).toBeNull()
    expect(normalizeInviteCode('ABCDE-0123U')).toBeNull()
  })

  it('formats and builds links on the public web URL, never the page origin', () => {
    expect(formatInviteCode('ABCDE01234')).toBe('ABCDE-01234')
    const url = inviteUrl('ABCDE01234')
    expect(url).toMatch(/\/\?add=ABCDE-01234$/)
    expect(url.startsWith('https://localhost')).toBe(false)
  })

  it('tells legacy share-id links apart from invite codes', () => {
    expect(isLegacyShareId('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(true)
    expect(isLegacyShareId('ABCDE-01234')).toBe(false)
  })
})

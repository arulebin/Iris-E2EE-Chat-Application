import { describe, expect, it } from 'vitest'
import type { Message } from '@/state/services'
import { buildTimeline, clockTime, dateLabel, lastSeenLabel, listTime, previewText } from './timeline'
import { formatInviteCode, groupSafetyDigits, initials, isValidUsername, normalizeInviteCode, passwordStrength, usernameIssue } from './validation'

const msg = (id: string, senderId: string, at: number): Message => ({
  id,
  chatId: 'c',
  senderId,
  senderName: senderId,
  fromMe: senderId === 'me',
  text: id,
  at,
  status: 'read',
})

describe('username validation', () => {
  it('matches ^[A-Za-z0-9_]{3,32}$', () => {
    for (const ok of ['abc', 'A_b9', 'x'.repeat(32)]) expect(isValidUsername(ok)).toBe(true)
    for (const bad of ['ab', 'x'.repeat(33), 'a b', 'ñandú', 'a-b', '']) expect(isValidUsername(bad)).toBe(false)
  })
  it('classifies issues', () => {
    expect(usernameIssue('')).toBe('empty')
    expect(usernameIssue('ab')).toBe('too-short')
    expect(usernameIssue('a'.repeat(33))).toBe('too-long')
    expect(usernameIssue('a!b')).toBe('bad-chars')
    expect(usernameIssue('good_name')).toBeNull()
  })
})

describe('password strength', () => {
  it('scales with length and variety', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('short')).toBe(1)
    expect(passwordStrength('longenough')).toBe(1)
    expect(passwordStrength('longenoughpassword')).toBe(2)
    expect(passwordStrength('LongEnoughPassword1!')).toBe(4)
  })
})

describe('invite codes', () => {
  it('normalizes typed, confusable and URL forms', () => {
    expect(normalizeInviteCode('k7q2m-9xd4v')).toBe('K7Q2M9XD4V')
    expect(normalizeInviteCode('https://iris.chat/?add=K7Q2M-9XD4V')).toBe('K7Q2M9XD4V')
    expect(normalizeInviteCode('O1L-ABCDE-FG')).toBe('011ABCDEFG')
    expect(normalizeInviteCode('short')).toBeNull()
    expect(normalizeInviteCode('UUUUU-UUUUU')).toBeNull()
  })
  it('formats', () => {
    expect(formatInviteCode('K7Q2M9XD4V')).toBe('K7Q2M-9XD4V')
  })
})

describe('misc helpers', () => {
  it('groups safety digits into 12 groups of 5', () => {
    const g = groupSafetyDigits('1'.repeat(60))
    expect(g).toHaveLength(12)
    expect(g.every(x => x.length === 5)).toBe(true)
  })
  it('initials', () => {
    expect(initials('Mira Kapoor')).toBe('MK')
    expect(initials('dev')).toBe('D')
    expect(initials('  ')).toBe('?')
  })
  it('previewText collapses whitespace and truncates', () => {
    expect(previewText('a\n\n b')).toBe('a b')
    expect(previewText('x'.repeat(100), 10)).toHaveLength(10)
  })
})

describe('time formatting', () => {
  const now = new Date(2026, 9, 20, 15, 30).getTime()
  it('labels days', () => {
    expect(dateLabel(now, now)).toBe('Today')
    expect(dateLabel(now - 86_400_000, now)).toBe('Yesterday')
  })
  it('list time', () => {
    expect(listTime(new Date(2026, 9, 20, 9, 5).getTime(), now)).toBe('09:05')
    expect(listTime(now - 86_400_000, now)).toBe('Yesterday')
  })
  it('clock and last seen', () => {
    expect(clockTime(new Date(2026, 0, 1, 7, 3).getTime())).toBe('07:03')
    expect(lastSeenLabel(undefined)).toBe('offline')
    expect(lastSeenLabel(now - 5 * 60_000, now)).toBe('last seen 5 min ago')
  })
})

describe('buildTimeline', () => {
  const base = new Date(2026, 9, 20, 12, 0).getTime()
  it('groups runs and inserts date separators (newest first)', () => {
    // newest-first
    const list = [msg('d', 'me', base + 60_000), msg('c', 'me', base + 30_000), msg('b', 'x', base), msg('a', 'x', base - 86_400_000)]
    const tl = buildTimeline(list, { now: base + 120_000 })
    const kinds = tl.map(i => (i.type === 'message' ? i.message.id : i.type === 'date' ? `date:${i.label}` : i.type))
    expect(kinds).toEqual(['d', 'c', 'b', 'date:Today', 'a', 'date:Yesterday'])
    const byId = Object.fromEntries(tl.flatMap(i => (i.type === 'message' ? [[i.message.id, i]] : [])))
    expect(byId.d).toMatchObject({ last: true, first: false })
    expect(byId.c).toMatchObject({ last: false, first: true })
    expect(byId.b).toMatchObject({ first: true, last: true })
  })
  it('splits runs after a 5 minute gap and puts typing first', () => {
    const list = [msg('b', 'x', base + 10 * 60_000), msg('a', 'x', base)]
    const tl = buildTimeline(list, { typing: true, now: base })
    expect(tl[0]!.type).toBe('typing')
    expect(tl.filter(i => i.type === 'message').every(i => i.type === 'message' && i.first && i.last)).toBe(true)
  })
})

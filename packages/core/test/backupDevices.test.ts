import { describe, expect, it } from 'vitest'
import {
  BACKUP_INTERVAL_MS,
  claimInstallKey,
  deriveInstallKey,
  getMessages,
  importAll,
  isBackupDue,
  upsertMessage,
  type ChatMessage,
  type SignalContext,
} from '../src/index.ts'
import { fakeWrapper, setup, subtleProvider } from './env.ts'

const msg = (id: number, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, from: 'bob', to: 'alice', content, sentAt: new Date(Date.UTC(2026, 9, 20, 10, id)).toISOString(), v: 2, ...extra,
})

describe('restore merge', () => {
  it('adds missing messages, keeps local copies of known ones, and leaves new arrivals alone', async () => {
    setup(subtleProvider(), { keyWrapperFor: () => fakeWrapper() })
    const me = `alice${Math.random().toString(36).slice(2, 8)}`
    // On this device: message 2 (viewed here since the backup) and 5 (arrived during the restore).
    await upsertMessage(me, 'bob', msg(2, 'two', { viewOnce: true, viewedAt: '2026-10-20T12:00:00.000Z' }))
    await upsertMessage(me, 'bob', msg(5, 'five'))

    const added = await importAll(me, {
      bob: [msg(1, 'one', { mediaId: 'm1', mediaKey: 'k1' }), msg(2, 'two', { viewOnce: true, viewedAt: null, mediaKey: 'k2' }), msg(3, 'three')],
      'group:g1': [msg(4, 'four', { groupId: 'g1' })],
      carol: [{ from: 'carol', to: 'alice', content: 'pending', sentAt: '2026-10-20T09:00:00.000Z', clientId: 'c1' }],
    })

    expect(added).toBe(3)
    const bob = await getMessages(me, 'bob')
    expect(bob.map(m => m.id)).toEqual([1, 2, 3, 5])
    // Local state wins; the backup only fills what the local copy lacked.
    expect(bob[1]).toMatchObject({ viewedAt: '2026-10-20T12:00:00.000Z', mediaKey: 'k2' })
    // Media references survive, so media still on the server can be fetched again.
    expect(bob[0]).toMatchObject({ mediaId: 'm1', mediaKey: 'k1' })
    expect((await getMessages(me, 'group:g1')).map(m => m.id)).toEqual([4])
    expect(await getMessages(me, 'carol')).toEqual([])
    // Idempotent.
    expect(await importAll(me, { bob: [msg(1, 'one'), msg(3, 'three')] })).toBe(0)
  })
})

describe('automatic backup schedule', () => {
  const now = Date.UTC(2026, 9, 20)
  it('is due on the first run and after the interval', () => {
    expect(isBackupDue(null, 'daily', now)).toBe(true)
    expect(isBackupDue(now - BACKUP_INTERVAL_MS.daily + 60_000, 'daily', now)).toBe(false)
    expect(isBackupDue(now - BACKUP_INTERVAL_MS.daily, 'daily', now)).toBe(true)
    expect(isBackupDue(now - 3 * BACKUP_INTERVAL_MS.daily, 'weekly', now)).toBe(false)
    expect(isBackupDue(now - BACKUP_INTERVAL_MS.weekly, 'weekly', now)).toBe(true)
  })
  it('never runs on its own when manual', () => {
    expect(isBackupDue(null, 'manual', now)).toBe(false)
    expect(isBackupDue(0, 'manual', now)).toBe(false)
  })
})

describe('install key', () => {
  it('is a per-account HMAC of the platform id', async () => {
    setup(subtleProvider())
    const a = await deriveInstallKey('alice', '9774d56d682e549c')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await deriveInstallKey('alice', '9774d56d682e549c')).toBe(a)
    expect(await deriveInstallKey('bob', '9774d56d682e549c')).not.toBe(a)
    expect(await deriveInstallKey('alice', '0000000000000001')).not.toBe(a)
    expect(a).not.toContain('9774d56d682e549c')
  })

  it('is claimed once per device, and never without a key', async () => {
    const calls: { url: string; body: unknown }[] = []
    let key: string | null = 'f'.repeat(64)
    const p = setup(subtleProvider(), {
      installKey: async () => key,
      apiFetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) })
        return new Response(JSON.stringify({ removed: [3] }), { status: 200 })
      },
    })
    const ctx = { me: 'ebin', deviceId: 4 } as SignalContext
    expect(await claimInstallKey(ctx, 'tok', p.kv)).toEqual([3])
    expect(calls).toEqual([{ url: '/api/signal/devices/4/install-key', body: { installKey: 'f'.repeat(64) } }])
    expect(await claimInstallKey(ctx, 'tok', p.kv)).toEqual([])
    expect(calls).toHaveLength(1)

    key = null
    expect(await claimInstallKey({ me: 'web', deviceId: 1 } as SignalContext, 'tok', p.kv)).toEqual([])
    expect(calls).toHaveLength(1)
  })
})

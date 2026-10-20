import { describe, expect, it } from 'vitest'
import { KeyHelper } from '@privacyresearch/libsignal-protocol-typescript'
import { memoryKV } from '../signal/kv'
import { SignalStore } from '../signal/store'
import { b64, generatePreKeys, generateSignedPreKey } from '../signal/device'
import { decryptFromDevice, encryptForDevice, startSession } from '../signal/messaging'
import { HistoryStore } from '../messageStore'
import type { ChatMessage } from '../../types'
import type { GroupEventDto, GroupMemberDto } from './api'
import { groupTargets, type GroupRecipient } from './fanout'
import {
  decodeGroupPayload, describeEvent, encodeGroupPayload, eventsAsMessages, groupIdOfPeer, groupPeer,
  isGroupPeer, mergeTimeline, readByAllAt,
} from './payload'

const key = (n: number) => new Uint8Array([5, n]).buffer

describe('group payload', () => {
  it('round-trips the group id and body inside the plaintext', () => {
    const wire = encodeGroupPayload('g-1', 'hello "team" 👋')
    expect(decodeGroupPayload(wire)).toEqual({ groupId: 'g-1', inner: 'hello "team" 👋' })
  })

  it('carries a media envelope untouched', () => {
    const media = JSON.stringify({ iris: 'media', v: 1, key: 'abc', mime: 'image/png', caption: '' })
    expect(decodeGroupPayload(encodeGroupPayload('g', media))?.inner).toBe(media)
  })

  it('ignores 1:1 plaintext and malformed wrappers', () => {
    expect(decodeGroupPayload('just text')).toBeNull()
    expect(decodeGroupPayload('{"iris":"media","v":1}')).toBeNull()
    expect(decodeGroupPayload('{"iris":"group","v":2,"gid":"g","m":"x"}')).toBeNull()
    expect(decodeGroupPayload('{"iris":"group","v":1,"gid":7,"m":"x"}')).toBeNull()
    expect(decodeGroupPayload('{not json')).toBeNull()
  })

  it('maps groups to a history pseudo-peer', () => {
    expect(groupPeer('abc')).toBe('group:abc')
    expect(isGroupPeer('group:abc')).toBe(true)
    expect(groupIdOfPeer('group:abc')).toBe('abc')
    expect(groupIdOfPeer('bob')).toBeNull()
  })
})

describe('group fan-out targets', () => {
  const members: GroupRecipient[] = [
    { user: 'alice', identity: key(1) },
    { user: 'bob', identity: key(2) },
    { user: 'carol', identity: key(3) },
    { user: 'dave', identity: null },   // legacy-only: no Signal devices
  ]
  const devices = { alice: [1, 2], bob: [1], carol: [1, 4], dave: [] }

  it('covers every member device except the sending one', () => {
    const t = groupTargets('alice', 1, key(1), members, devices).map(x => `${x.user}:${x.deviceId}`)
    expect(t.sort()).toEqual(['alice:2', 'bob:1', 'carol:1', 'carol:4'])
  })

  it('pins each target to the member identity it was resolved with', () => {
    const t = groupTargets('alice', 1, key(1), members, devices)
    expect(new Uint8Array(t.find(x => x.user === 'carol')!.identity)).toEqual(new Uint8Array(key(3)))
  })

  it('refuses to encrypt to a member with devices but no accepted identity', () => {
    expect(() => groupTargets('alice', 1, key(1), [...members, { user: 'erin', identity: null }], { ...devices, erin: [1] }))
      .toThrow(/erin/)
  })

  it('ignores duplicate member entries', () => {
    const t = groupTargets('alice', 1, key(1), [...members, members[1]], devices)
    expect(t.filter(x => x.user === 'bob')).toHaveLength(1)
  })
})

describe('group delivery over Signal sessions', () => {
  async function device(user: string, deviceId: number) {
    const store = new SignalStore(user, memoryKV())
    const id = await KeyHelper.generateIdentityKeyPair()
    await store.setIdentityKeyPair(id)
    await store.setDevice({ deviceId, registrationId: KeyHelper.generateRegistrationId(), nextPreKeyId: 1, signedPreKeys: [] })
    let n = 100
    return {
      store, id,
      bundle: async () => ({
        deviceId,
        registrationId: (await store.getLocalRegistrationId())!,
        identityKey: b64(id.pubKey),
        signedPreKey: await generateSignedPreKey(store, id, n++),
        preKey: (await generatePreKeys(store, n++, 1))[0],
      }),
    }
  }

  it('every member opens the same group message and files it under the group', async () => {
    const alice = await device('alice', 1)
    const bob = await device('bob', 1)
    const carol = await device('carol', 1)
    const wire = encodeGroupPayload('g-42', 'dinner at 8?')

    for (const [name, d] of [['bob', bob], ['carol', carol]] as const) {
      await startSession(alice.store, name, await d.bundle(), d.id.pubKey)
      const env = await encryptForDevice(alice.store, name, 1, wire)
      const opened = decodeGroupPayload(await decryptFromDevice(d.store, 'alice', 1, env.type, env.body))
      expect(opened).toEqual({ groupId: 'g-42', inner: 'dinner at 8?' })
    }
  })
})

describe('group history', () => {
  const msg = (id: number, from: string, content: string, sentAt: string): ChatMessage =>
    ({ id, from, to: 'group:g1', content, sentAt, v: 2, groupId: 'g1' })

  it('stores group conversations encrypted and includes them in the backup export', async () => {
    const kv = memoryKV()
    const h = new HistoryStore('gh1', kv, null)
    await h.upsertMany(groupPeer('g1'), [msg(2, 'bob', 'second', '2026-01-01T10:01:00Z'), msg(1, 'alice', 'first', '2026-01-01T10:00:00Z')])
    await h.upsertMessage('bob', { id: 9, from: 'bob', to: 'gh1', content: 'dm', sentAt: '2026-01-01T09:00:00Z', v: 2 })

    const stored = await kv.get<unknown>('iris-msgs-v2:gh1:group:g1')
    expect(stored).toBeInstanceOf(Uint8Array)            // ciphertext, not a plaintext array
    expect(new TextDecoder().decode(stored as Uint8Array)).not.toContain('second')

    const exported = await h.exportAll()
    expect(Object.keys(exported).sort()).toEqual(['bob', 'group:g1'])
    expect(exported['group:g1'].map(m => m.content)).toEqual(['first', 'second'])

    const restored = new HistoryStore('gh1', memoryKV(), null)
    await restored.importAll(exported)
    expect((await restored.getMessages(groupPeer('g1'))).map(m => m.id)).toEqual([1, 2])
  })
})

describe('group timeline helpers', () => {
  const members: GroupMemberDto[] = [
    { username: 'alice', preferredName: 'Alice', avatarUrl: null, role: 'ADMIN', joinedAt: '', lastReadAt: '2026-01-01T10:05:00Z' },
    { username: 'bob', preferredName: null, avatarUrl: null, role: 'MEMBER', joinedAt: '', lastReadAt: '2026-01-01T10:02:00Z' },
    { username: 'me', preferredName: null, avatarUrl: null, role: 'MEMBER', joinedAt: '', lastReadAt: null },
  ]

  it('describes membership events from the viewer\'s perspective', () => {
    const e = (type: GroupEventDto['type'], actor: string, target: string | null = null, detail: string | null = null): GroupEventDto =>
      ({ id: 1, type, actor, target, detail, at: '2026-01-01T00:00:00Z' })
    expect(describeEvent(e('ADDED', 'alice', 'me'), 'me', members)).toBe('Alice added You')
    expect(describeEvent(e('LEFT', 'bob'), 'me', members)).toBe('bob left')
    expect(describeEvent(e('RENAMED', 'me', null, 'Trip'), 'me', members)).toBe('You renamed the group to "Trip"')
    expect(describeEvent(e('PROMOTED', 'alice', 'me'), 'me', members)).toBe('You are now an admin')
  })

  it('interleaves system lines with messages chronologically', () => {
    const sys = eventsAsMessages([{ id: 5, type: 'JOINED', actor: 'bob', target: null, detail: null, at: '2026-01-01T10:00:30Z' }], 'me', members)
    const timeline = mergeTimeline([
      { id: 1, from: 'alice', to: '', content: 'a', sentAt: '2026-01-01T10:00:00Z' },
      { id: 2, from: 'bob', to: '', content: 'b', sentAt: '2026-01-01T10:01:00Z' },
    ], sys)
    expect(timeline.map(m => m.system ? 'sys' : m.content)).toEqual(['a', 'sys', 'b'])
  })

  it('counts a message as read only once every other member has read past it', () => {
    expect(readByAllAt(members, 'me')).toBe(Date.parse('2026-01-01T10:02:00Z'))
    expect(readByAllAt(members, 'me', { bob: Date.parse('2026-01-01T10:09:00Z') })).toBe(Date.parse('2026-01-01T10:05:00Z'))
    expect(readByAllAt([members[2]], 'me')).toBe(0)
  })
})

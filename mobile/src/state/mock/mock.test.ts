import { describe, expect, it } from 'vitest'
import { AuthError, ServiceError, type Topic } from '../services'
import { createMockServices, fakeSafetyDigits } from './index'

const make = (o = {}) => createMockServices({ latency: 0, autoReply: false, signedIn: true, ...o })

describe('mock auth', () => {
  it('starts signed out, logs in, locks and unlocks', async () => {
    const s = make({ signedIn: false })
    expect(await s.auth.getSession()).toBeNull()
    await s.auth.login('alice', 'pw')
    expect((await s.auth.getSession())?.username).toBe('alice')
    await s.auth.lock()
    expect((await s.auth.getSession())?.locked).toBe(true)
    await expect(s.auth.unlock('nope')).rejects.toMatchObject({ code: 'bad-password' })
    expect((await s.auth.unlock('pw')).locked).toBe(false)
  })
  it('validates and rejects taken usernames on signup', async () => {
    const s = make({ signedIn: false })
    expect(await s.auth.isUsernameAvailable('mira')).toBe(false)
    await expect(s.auth.signup('mira', 'secret123')).rejects.toBeInstanceOf(AuthError)
    await expect(s.auth.signup('a!', 'secret123')).rejects.toMatchObject({ code: 'invalid-username' })
    expect((await s.auth.signup('fresh_one', 'secret123')).username).toBe('fresh_one')
  })
  it('emits session events', async () => {
    const s = make({ signedIn: false })
    let n = 0
    s.events.on('session', () => n++)
    await s.auth.login('a', 'b')
    await s.auth.logout()
    expect(n).toBe(2)
  })
})

describe('mock chats', () => {
  it('lists pinned chats first and groups separately', async () => {
    const s = make()
    const chats = await s.chats.list()
    expect(chats[0]!.pinned).toBe(true)
    expect(chats.some(c => c.kind === 'group')).toBe(true)
  })
  it('sends a message, newest first, with a reply reference, and notifies', async () => {
    const s = make()
    const seen: Topic[] = []
    s.events.on('messages:chat-c1', () => seen.push('messages:chat-c1'))
    const first = (await s.chats.messages('chat-c1'))[0]!
    const sent = await s.chats.send('chat-c1', 'hello there', first.id)
    expect(sent.replyTo?.id).toBe(first.id)
    const after = await s.chats.messages('chat-c1')
    expect(after[0]!.text).toBe('hello there')
    expect(seen.length).toBeGreaterThan(0)
    const summary = await s.chats.get('chat-c1')
    expect(summary!.lastMessage!.text).toBe('hello there')
  })
  it('paginates with a before cursor', async () => {
    const s = make()
    const all = await s.chats.messages('chat-c1', { limit: 100 })
    const page = await s.chats.messages('chat-c1', { before: all[2]!.at, limit: 2 })
    expect(page).toHaveLength(2)
    expect(page.every(m => m.at < all[2]!.at)).toBe(true)
  })
  it('marks read, deletes for me, pin/mute/archive', async () => {
    const s = make()
    expect((await s.chats.get('chat-c1'))!.unread).toBe(2)
    await s.chats.markRead('chat-c1')
    expect((await s.chats.get('chat-c1'))!.unread).toBe(0)
    const m = (await s.chats.messages('chat-c1'))[0]!
    await s.chats.deleteForMe('chat-c1', m.id)
    expect((await s.chats.messages('chat-c1')).find(x => x.id === m.id)).toBeUndefined()
    await s.chats.setMuted('chat-c2', true)
    await s.chats.setArchived('chat-c2', true)
    const c2 = (await s.chats.get('chat-c2'))!
    expect(c2.muted && c2.archived).toBe(true)
  })
  it('opens a new direct chat for a contact without history', async () => {
    const s = make()
    const id = await s.chats.openDirect('c5')
    expect(id).toBe('chat-c5')
    expect(await s.chats.messages(id)).toEqual([])
    await expect(s.chats.openDirect('missing')).rejects.toBeInstanceOf(ServiceError)
  })
  it('simulates a read receipt and a reply when autoReply is on', async () => {
    const s = createMockServices({ latency: 0, autoReply: true, signedIn: true })
    const sent = await s.chats.send('chat-c3', 'ping')
    expect(sent.status).toBe('sending')
    await new Promise(r => setTimeout(r, 2500))
    const m = (await s.chats.messages('chat-c3')).find(x => x.id === sent.id)!
    expect(['delivered', 'read']).toContain(m.status)
  }, 10_000)
})

describe('mock contacts / groups / safety / privacy', () => {
  it('accepts requests into contacts', async () => {
    const s = make()
    const before = (await s.contacts.list()).length
    const [req] = await s.contacts.requests()
    await s.contacts.acceptRequest(req!.id)
    expect((await s.contacts.list()).length).toBe(before + 1)
    expect(await s.contacts.requests()).toHaveLength(1)
  })
  it('adds by invite code, rejects duplicates and garbage', async () => {
    const s = make()
    const c = await s.contacts.add('K7Q2M-9XD4V')
    expect(c.username).toMatch(/^user_/)
    await expect(s.contacts.add('mira_k')).rejects.toMatchObject({ code: 'already-friends' })
    await expect(s.contacts.add('!!')).rejects.toMatchObject({ code: 'invalid-code' })
    await expect(s.contacts.add('0AAAA-AAAAA')).rejects.toMatchObject({ code: 'not-found' })
  })
  it('block and unblock', async () => {
    const s = make()
    await s.contacts.block('c2')
    expect((await s.contacts.blocked()).map(c => c.id)).toContain('c2')
    await s.contacts.unblock('c2')
    expect((await s.contacts.blocked()).map(c => c.id)).not.toContain('c2')
  })
  it('creates and edits groups', async () => {
    const s = make()
    const id = await s.groups.create('Lunch', ['c1', 'c2'])
    const g = (await s.groups.get(id))!
    expect(g.members).toHaveLength(3)
    expect(g.members.find(m => m.isMe)!.role).toBe('owner')
    await s.groups.rename(id, 'Dinner')
    expect((await s.chats.get(id))!.title).toBe('Dinner')
    const before = g.inviteLink
    expect(await s.groups.resetInvite(id)).not.toBe(before)
    await s.groups.leave(id)
    expect(await s.groups.get(id)).toBeNull()
  })
  it('safety numbers are 60 digits and symmetric', async () => {
    const s = make()
    const info = await s.safety.get('c1')
    expect(info.digits).toMatch(/^\d{60}$/)
    expect(fakeSafetyDigits('a', 'b')).toBe(fakeSafetyDigits('b', 'a'))
    expect(fakeSafetyDigits('a', 'b')).not.toBe(fakeSafetyDigits('a', 'c'))
    await s.safety.setVerified('c4', true)
    expect((await s.safety.get('c4')).verified).toBe(true)
  })
  it('privacy toggles and rotating the invite code', async () => {
    const s = make()
    await s.privacy.setPrivateProfile(true)
    const old = (await s.privacy.get()).inviteCode
    const next = await s.privacy.rotateInvite()
    expect(next.privateProfile).toBe(true)
    expect(next.inviteCode).not.toBe(old)
    expect(next.inviteUrl).toContain(next.inviteCode)
  })
  it('settings, backup and devices', async () => {
    const s = make()
    expect((await s.settings.update({ theme: 'dark' })).theme).toBe('dark')
    expect((await s.backup.backupNow()).enabled).toBe(true)
    await s.devices.revoke('d1') // current device cannot be revoked
    const ds = await s.devices.list()
    expect(ds.find(d => d.current)).toBeDefined()
    await s.devices.revoke('d2')
    expect((await s.devices.list()).find(d => d.id === 'd2')).toBeUndefined()
  })
})

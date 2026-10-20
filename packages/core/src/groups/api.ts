import { getPlatform } from '../platform.ts'

// /api/groups/* — group metadata and membership. The server sees names, avatars
// and member lists (see GroupChat.java for that tradeoff); message content only
// ever travels as per-device Signal envelopes.

export type GroupRole = 'ADMIN' | 'MEMBER'

export type GroupMemberDto = {
  username: string
  preferredName: string | null
  avatarUrl: string | null
  role: GroupRole
  joinedAt: string
  lastReadAt: string | null
}

export type GroupDto = {
  id: string
  name: string
  avatarUrl: string | null
  createdBy: string
  createdAt: string
  myRole: GroupRole | null
  members: GroupMemberDto[]
  /** Only present for admins. */
  inviteToken: string | null
}

export type GroupEventType = 'CREATED' | 'ADDED' | 'REMOVED' | 'LEFT' | 'JOINED' | 'RENAMED' | 'AVATAR' | 'PROMOTED' | 'DEMOTED'

export type GroupEventDto = {
  id: number
  actor: string
  type: GroupEventType
  target: string | null
  detail: string | null
  at: string
}

export type InvitePreview = { groupId: string; name: string; avatarUrl: string | null; memberCount: number; alreadyMember: boolean }

export class GroupApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const p = getPlatform()
  const res = await p.fetch(`${p.apiBase}/api/groups${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    // Spring's error body carries the human-readable reason in `message` when present.
    let message = `Request failed (${res.status})`
    try {
      const err = await res.json()
      if (typeof err?.message === 'string' && err.message) message = err.message
    } catch { /* not JSON */ }
    throw new GroupApiError(res.status, message)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const enc = encodeURIComponent

export const groupApi = {
  mine: (token: string) => call<GroupDto[]>(token, 'GET', ''),
  get: (token: string, id: string) => call<GroupDto>(token, 'GET', `/${enc(id)}`),
  create: (token: string, name: string, members: string[]) => call<GroupDto>(token, 'POST', '', { name, members }),
  update: (token: string, id: string, patch: { name?: string; avatarUrl?: string }) =>
    call<GroupDto>(token, 'PUT', `/${enc(id)}`, patch),
  events: (token: string, id: string) => call<GroupEventDto[]>(token, 'GET', `/${enc(id)}/events`),
  addMembers: (token: string, id: string, usernames: string[]) =>
    call<GroupDto>(token, 'POST', `/${enc(id)}/members`, { usernames }),
  /** Remove someone (admin) — or pass your own username to leave. */
  removeMember: (token: string, id: string, username: string) =>
    call<GroupDto | undefined>(token, 'DELETE', `/${enc(id)}/members/${enc(username)}`),
  setRole: (token: string, id: string, username: string, role: GroupRole) =>
    call<GroupDto>(token, 'PUT', `/${enc(id)}/members/${enc(username)}/role`, { role }),
  resetInvite: (token: string, id: string) => call<GroupDto>(token, 'POST', `/${enc(id)}/invite`),
  disableInvite: (token: string, id: string) => call<GroupDto>(token, 'DELETE', `/${enc(id)}/invite`),
  previewInvite: (token: string, inviteToken: string) => call<InvitePreview>(token, 'GET', `/invite/${enc(inviteToken)}`),
  join: (token: string, inviteToken: string) => call<GroupDto>(token, 'POST', `/invite/${enc(inviteToken)}/join`),
}

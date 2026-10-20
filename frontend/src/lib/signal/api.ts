import { apiBase } from '../config'

// Thin wrappers over /api/signal/*. All keys are base64; the server only stores
// public material (plus the identity private key wrapped under a password KEK).

export type PreKeyDto = { keyId: number; publicKey: string }
export type SignedPreKeyDto = PreKeyDto & { signature: string }
export type BundleDto = {
  deviceId: number
  registrationId: number
  identityKey: string
  signedPreKey: SignedPreKeyDto
  preKey: PreKeyDto | null
}
export type MyIdentityDto = {
  identityKey: string | null
  encryptedIdentityKey: string | null
  identityKeySalt: string | null
  crossSignature: string | null
}
export type PublicIdentityDto = { identityKey: string; crossSignature: string | null }
export type DeviceDto = { deviceId: number; registrationId: number; label?: string | null; createdAt?: string; lastSeen?: string }

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase}/api/signal${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new HttpError(res.status, `${method} /api/signal${path} failed: ${res.status}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const enc = encodeURIComponent

export const signalApi = {
  myIdentity: (token: string) => call<MyIdentityDto>(token, 'GET', '/identity/me'),
  publishIdentity: (token: string, body: { identityKey: string; encryptedIdentityKey: string; identityKeySalt: string; crossSignature: string | null }) =>
    call<void>(token, 'POST', '/identity', body),
  /** null when the user has no Signal identity yet (legacy-only account). */
  identityOf: async (token: string, username: string): Promise<PublicIdentityDto | null> => {
    try {
      return await call<PublicIdentityDto>(token, 'GET', `/identity/${enc(username)}`)
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null
      throw err
    }
  },

  registerDevice: (token: string, body: { registrationId: number; label: string; signedPreKey: SignedPreKeyDto; preKeys: PreKeyDto[] }) =>
    call<{ deviceId: number }>(token, 'POST', '/devices', body),
  devicesOf: (token: string, username: string) => call<DeviceDto[]>(token, 'GET', `/devices/${enc(username)}`),
  removeDevice: (token: string, deviceId: number) => call<void>(token, 'DELETE', `/devices/${deviceId}`),
  uploadPreKeys: (token: string, deviceId: number, preKeys: PreKeyDto[]) =>
    call<{ count: number }>(token, 'POST', `/devices/${deviceId}/prekeys`, { preKeys }),
  preKeyCount: (token: string, deviceId: number) => call<{ count: number }>(token, 'GET', `/devices/${deviceId}/prekeys/count`),
  rotateSignedPreKey: (token: string, deviceId: number, spk: SignedPreKeyDto) =>
    call<void>(token, 'PUT', `/devices/${deviceId}/signed-prekey`, spk),

  /** Consumes one of the device's one-time prekeys. */
  bundle: (token: string, username: string, deviceId: number) => call<BundleDto>(token, 'GET', `/bundle/${enc(username)}/${deviceId}`),
}

import { apiBase } from '../config'

/** Upload a group photo through the profile-image endpoint; returns its filename. */
export async function uploadGroupAvatar(file: File, token: string): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${apiBase}/api/media/profile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error(res.status === 413 ? 'That image is too large (max 5 MB)' : 'Failed to upload the group photo')
  const data = await res.json() as { mediaId: string }
  return data.mediaId
}

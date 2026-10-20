import { Directory, File, Paths } from 'expo-file-system'
import { toHex } from '@iris/core'
import { mediaCrypto } from './config'

/**
 * All media scratch space lives under the app-private cache dir (never the gallery, never shared storage):
 *   cache/iris-media/tmp   upload ciphertext + processed copies (deleted right after use)
 *   cache/iris-media/dl    decrypted received media (evictable by the OS)
 *   cache/iris-media/vo    decrypted view-once media (deleted on close, purged at startup)
 */
export type Bucket = 'tmp' | 'dl' | 'vo'

export function bucketDir(bucket: Bucket): Directory {
  const root = new Directory(Paths.cache, 'iris-media')
  const dir = new Directory(root, bucket)
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

export function randomId(bytes = 8): string {
  return toHex(mediaCrypto().randomBytes(bytes))
}

export function newTempFile(bucket: Bucket, ext: string): File {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
  return new File(bucketDir(bucket), `${randomId()}.${safeExt}`)
}

export function safeDelete(f: File | string | null | undefined): void {
  if (!f) return
  try {
    const file = typeof f === 'string' ? new File(f) : f
    if (file.exists) file.delete()
  } catch {
    // best effort
  }
}

/** Remove everything in a bucket (view-once leftovers, stale temp files). */
export function purgeBucket(bucket: Bucket): void {
  try {
    const dir = bucketDir(bucket)
    for (const entry of dir.list()) {
      try {
        entry.delete()
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/** Call once at app start: drops orphaned plaintext that a crash may have left behind. */
export function cleanupMediaScratch(): void {
  purgeBucket('vo')
  purgeBucket('tmp')
}

/** Delete decrypted received media (settings > storage > clear). */
export function clearDecryptedCache(): void {
  purgeBucket('dl')
}

import { Image as RNImage } from 'react-native'
import { File, UploadType, DownloadTask, Directory } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Image as ExpoImage } from 'expo-image'
import { Video as VideoCompressor, createVideoThumbnail, getRealPath, getVideoMetaData } from 'react-native-compressor'
import { mediaConfig, mediaCrypto } from './config'
import { decryptMediaBytes, encryptMediaBytes } from './mediaCrypto'
import { buildMediaEnvelope } from './envelope'
import { bucketDir, newTempFile, randomId, safeDelete } from './files'
import {
  checkPlaintextSize, extensionForMime, extensionOf, fitWithin, guessMime, kindFromMime, safeFileName, wireMimeFor,
} from './helpers'
import {
  HD_MAX_IMAGE_EDGE, IMAGE_QUALITY_HD, IMAGE_QUALITY_STANDARD, MAX_IMAGE_EDGE, MAX_PLAINTEXT_BYTES,
} from './limits'
import type { EditedMedia, MediaKind, TransferStatus, UploadedMedia } from './types'
import { markViewOnceExpired } from './viewOnceStore'

// ---------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------

export type MediaErrorCode =
  | 'too-large' | 'unsupported' | 'network' | 'unauthorized' | 'forbidden' | 'not-found' | 'gone' | 'undecryptable'
  | 'cancelled' | 'unknown'

export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, message: string, readonly status?: number) {
    super(message)
    this.name = 'MediaError'
  }
}

function statusFromError(e: unknown): number | undefined {
  const m = /status:?\s*(\d{3})/i.exec(e instanceof Error ? e.message : String(e))
  return m ? Number(m[1]) : undefined
}

function toMediaError(e: unknown, signal?: AbortSignal): MediaError {
  if (e instanceof MediaError) return e
  if (signal?.aborted || (e instanceof Error && /abort|cancel/i.test(e.message))) return new MediaError('cancelled', 'Cancelled')
  const status = statusFromError(e)
  switch (status) {
    case 401: return new MediaError('unauthorized', 'Session expired', 401)
    case 403: return new MediaError('forbidden', 'Not allowed to open this media', 403)
    case 404: return new MediaError('not-found', 'This media is no longer available', 404)
    case 410: return new MediaError('gone', 'This media has expired', 410)
    case 413: return new MediaError('too-large', 'File too large', 413)
  }
  if (status && status >= 500) return new MediaError('network', `Server error (${status})`, status)
  return new MediaError('network', e instanceof Error ? e.message : 'Network error', status)
}

// ---------------------------------------------------------------------------------------------------------------------
// Prepare (compress / strip metadata / thumbnail / blurhash)
// ---------------------------------------------------------------------------------------------------------------------

export interface PreparedMedia {
  kind: MediaKind
  /** file:// uri of the bytes that will be encrypted. */
  uri: string
  /** True when `uri` is a scratch copy we own and may delete. */
  owned: boolean
  mime: string
  size: number
  width?: number
  height?: number
  duration?: number
  name?: string
  blurhash?: string
  /** Local thumbnail for optimistic bubbles. */
  thumbUri?: string
}

function fileSize(uri: string): number {
  const info = new File(uri).info()
  return info.exists ? (info.size ?? 0) : 0
}

/** content:// -> file:// (private cache copy). Compressor can resolve gallery content uris if the copy fails. */
async function toLocalFile(uri: string, kind: MediaKind, nameHint?: string): Promise<{ uri: string; owned: boolean }> {
  if (uri.startsWith('file://')) return { uri, owned: false }
  const dest = newTempFile('tmp', extensionOf(nameHint ?? uri) || (kind === 'video' ? 'mp4' : 'bin'))
  try {
    await new File(uri).copy(dest)
    return { uri: dest.uri, owned: true }
  } catch {
    if (kind === 'image' || kind === 'video') {
      const real = await getRealPath(uri, kind)
      return { uri: real.startsWith('file://') ? real : `file://${real}`, owned: false }
    }
    throw new MediaError('unsupported', 'Could not read this file')
  }
}

async function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject))
}

async function blurhashOf(uri: string): Promise<string | undefined> {
  try {
    return (await ExpoImage.generateBlurhashAsync(uri, [4, 3])) ?? undefined
  } catch {
    return undefined
  }
}

async function prepareImage(item: EditedMedia): Promise<PreparedMedia> {
  const isGif = item.mime === 'image/gif'
  if (isGif) {
    // Animated GIFs must not be re-encoded (would flatten the animation).
    const local = await toLocalFile(item.uri, 'image', item.name)
    const size = fileSize(local.uri)
    checkPlaintextSize(size)
    return {
      kind: 'image', uri: local.uri, owned: local.owned, mime: 'image/gif', size,
      width: item.width, height: item.height, thumbUri: local.uri, blurhash: await blurhashOf(local.uri),
    }
  }
  const src = item.width && item.height ? { width: item.width, height: item.height } : await imageSize(item.uri)
  const edge = item.hd ? HD_MAX_IMAGE_EDGE : MAX_IMAGE_EDGE
  const target = fitWithin(src.width, src.height, edge)
  const needsResize = target.width !== Math.round(src.width) || target.height !== Math.round(src.height)
  // Re-encoding (even without a resize) strips EXIF incl. GPS, which a privacy-first messenger wants.
  const keepsAlpha = item.mime === 'image/png' || item.mime === 'image/webp'
  const format = keepsAlpha ? SaveFormat.WEBP : SaveFormat.JPEG
  const out = await manipulateAsync(
    item.uri,
    needsResize ? [{ resize: target }] : [],
    { compress: item.hd ? IMAGE_QUALITY_HD : IMAGE_QUALITY_STANDARD, format },
  )
  const size = fileSize(out.uri)
  checkPlaintextSize(size)
  return {
    kind: 'image', uri: out.uri, owned: true,
    mime: format === SaveFormat.WEBP ? 'image/webp' : 'image/jpeg',
    size, width: out.width, height: out.height, thumbUri: out.uri, blurhash: await blurhashOf(out.uri),
  }
}

async function prepareVideo(item: EditedMedia, onProgress: (p: number) => void, signal?: AbortSignal): Promise<PreparedMedia> {
  const local = await toLocalFile(item.uri, 'video', item.name)
  let uri = local.uri
  let owned = local.owned
  let size = fileSize(uri)
  if (size > MAX_PLAINTEXT_BYTES) {
    // Too big for the 50 MB cap: transcode (720p-ish, 2.5 Mbps ~ 18 MB/min).
    let cancellationId = ''
    const onAbort = () => cancellationId && VideoCompressor.cancelCompression(cancellationId)
    signal?.addEventListener('abort', onAbort)
    try {
      const out = await VideoCompressor.compress(
        uri,
        { compressionMethod: 'manual', maxSize: 1280, bitrate: 2_500_000, getCancellationId: id => { cancellationId = id } },
        p => onProgress(Math.min(1, Math.max(0, p))),
      )
      if (owned) safeDelete(uri)
      uri = out.startsWith('file://') ? out : `file://${out}`
      owned = true
      size = fileSize(uri)
    } catch (e) {
      if (signal?.aborted) throw new MediaError('cancelled', 'Cancelled')
      throw new MediaError('too-large', `This video is too large to send (${(size / 1024 / 1024).toFixed(0)}MB, max 50MB) and could not be compressed`)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    if (size > MAX_PLAINTEXT_BYTES) {
      safeDelete(uri)
      throw new MediaError('too-large', 'This video is too long to send (50MB limit even after compression)')
    }
  }
  let meta: { width: number; height: number; duration: number } | undefined
  try {
    const m = await getVideoMetaData(uri)
    meta = { width: m.width, height: m.height, duration: m.duration }
  } catch {
    // fall back to what the picker told us
  }
  let thumbUri: string | undefined
  let blurhash: string | undefined
  try {
    const t = await createVideoThumbnail(uri, { quality: 0.6 })
    thumbUri = t.path.startsWith('file://') ? t.path : `file://${t.path}`
    blurhash = await blurhashOf(thumbUri)
  } catch {
    // no thumbnail is fine
  }
  const mime = item.mime.startsWith('video/') ? item.mime : guessMime(uri, 'video/mp4')
  return {
    kind: 'video', uri, owned, mime, size,
    width: meta?.width ?? item.width, height: meta?.height ?? item.height,
    duration: meta?.duration != null ? meta.duration : item.duration,
    thumbUri, blurhash,
  }
}

async function prepareFile(item: EditedMedia): Promise<PreparedMedia> {
  const local = await toLocalFile(item.uri, 'file', item.name)
  const size = fileSize(local.uri)
  checkPlaintextSize(size)
  return {
    kind: 'file', uri: local.uri, owned: local.owned,
    mime: item.mime || guessMime(item.name ?? local.uri), size, name: item.name ?? new File(local.uri).name,
  }
}

export async function prepareMedia(
  item: EditedMedia,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<PreparedMedia> {
  try {
    if (item.kind === 'image') return await prepareImage(item)
    if (item.kind === 'video') return await prepareVideo(item, opts.onProgress ?? (() => {}), opts.signal)
    return await prepareFile(item)
  } catch (e) {
    if (e instanceof MediaError) throw e
    if (e instanceof Error && /too large/i.test(e.message)) throw new MediaError('too-large', e.message)
    throw toMediaError(e, opts.signal)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Authenticated HTTP helpers
// ---------------------------------------------------------------------------------------------------------------------

async function withAuth<T>(fn: (headers: Record<string, string>) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const cfg = mediaConfig()
  let refreshed = false
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn({ Authorization: `Bearer ${await cfg.getToken()}` })
    } catch (e) {
      const err = toMediaError(e, signal)
      if (err.code === 'unauthorized' && !refreshed && cfg.refreshToken) {
        refreshed = true
        await cfg.refreshToken()
        continue
      }
      // Retry transient failures with backoff (1s, 3s); never retry 4xx or cancellation.
      if (err.code === 'network' && attempt < 2 && !signal?.aborted) {
        await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 3000))
        continue
      }
      throw err
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Encrypt + upload
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One outgoing attachment: prepare -> encrypt -> upload, with progress, cancel and retry.
 * Retry resumes from the failed stage (a finished encryption is reused, so the key and blob stay stable).
 */
export class UploadJob {
  private _status: TransferStatus = { state: 'idle', progress: 0 }
  private listeners = new Set<(s: TransferStatus) => void>()
  private abort = new AbortController()
  private prepared?: PreparedMedia
  private cipher?: { file: File; key: string }
  private result?: UploadedMedia
  private current: Promise<UploadedMedia>

  constructor(readonly item: EditedMedia) {
    this.current = this.run()
    this.current.catch(() => {})
  }

  get status(): TransferStatus { return this._status }
  /** Local thumbnail/preview available after preparation (for optimistic bubbles). */
  get preview(): PreparedMedia | undefined { return this.prepared }
  /** Resolves with the upload result of the latest attempt; rejects with MediaError. */
  done(): Promise<UploadedMedia> { return this.current }

  subscribe(fn: (s: TransferStatus) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  cancel(): void {
    this.abort.abort()
    this.set({ state: 'cancelled', progress: 0 })
  }

  /** Re-run after an error or cancellation. No-op while running / after success. */
  retry(): Promise<UploadedMedia> {
    if (this.result) return Promise.resolve(this.result)
    if (this._status.state !== 'error' && this._status.state !== 'cancelled') return this.current
    this.abort = new AbortController()
    this.current = this.run()
    this.current.catch(() => {})
    return this.current
  }

  /** Release scratch files. Call when the message is sent or discarded. */
  dispose(): void {
    if (this.cipher) safeDelete(this.cipher.file)
    if (this.prepared?.owned) safeDelete(this.prepared.uri)
    this.cipher = undefined
  }

  /** The JSON to put inside the E2E message (the messaging layer encrypts it). */
  envelope(caption: string): string {
    if (!this.result) throw new Error('Upload not finished')
    const r = this.result
    return buildMediaEnvelope(r.key, r.mimeType, caption, {
      name: r.name, size: r.size, w: r.width, h: r.height, dur: r.duration, bh: r.blurhash,
    })
  }

  private set(s: TransferStatus) {
    this._status = s
    this.listeners.forEach(l => l(s))
  }

  private async run(): Promise<UploadedMedia> {
    const signal = this.abort.signal
    try {
      if (!this.prepared) {
        this.set({ state: 'preparing', progress: 0 })
        this.prepared = await prepareMedia(this.item, {
          signal,
          onProgress: p => this.set({ state: 'preparing', progress: p }),
        })
      }
      const p = this.prepared
      if (signal.aborted) throw new MediaError('cancelled', 'Cancelled')

      if (!this.cipher) {
        this.set({ state: 'encrypting', progress: 0 })
        const plaintext = await new File(p.uri).bytes()
        const { ciphertext, key } = await encryptMediaBytes(mediaCrypto(), plaintext)
        const file = newTempFile('tmp', 'bin')
        file.create({ overwrite: true, intermediates: true })
        await file.write(ciphertext)
        this.cipher = { file, key }
      }
      if (signal.aborted) throw new MediaError('cancelled', 'Cancelled')

      this.set({ state: 'uploading', progress: 0 })
      const cipher = this.cipher
      const mediaId = await withAuth(async headers => {
        const res = await cipher.file.upload(`${mediaConfig().apiBase}/api/media`, {
          httpMethod: 'POST',
          uploadType: UploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'application/octet-stream',
          headers,
          signal,
          onProgress: ({ bytesSent, totalBytes }) =>
            this.set({ state: 'uploading', progress: totalBytes > 0 ? bytesSent / totalBytes : 0 }),
        })
        if (res.status < 200 || res.status >= 300) {
          throw new MediaError(toMediaError(new Error(`status ${res.status}`)).code, `Upload failed: ${res.status}`, res.status)
        }
        const id = (JSON.parse(res.body) as { mediaId?: string }).mediaId
        if (!id) throw new MediaError('unknown', 'Upload failed: bad response')
        return id
      }, signal)

      this.result = {
        mediaId,
        mimeType: p.mime,
        wireMimeType: wireMimeFor(p.mime),
        key: cipher.key,
        size: p.size,
        width: p.width,
        height: p.height,
        duration: p.duration,
        blurhash: p.blurhash,
        name: p.name,
      }
      safeDelete(cipher.file)
      this.cipher = undefined
      this.set({ state: 'done', progress: 1 })
      return this.result
    } catch (e) {
      const err = toMediaError(e, signal)
      this.set({ state: err.code === 'cancelled' ? 'cancelled' : 'error', progress: 0, error: err.message })
      throw err
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Download + decrypt
// ---------------------------------------------------------------------------------------------------------------------

export interface MediaRef {
  mediaId: string
  /** base64 AES key from the envelope */
  key: string
  mime: string
  name?: string
}

export interface LocalMedia {
  /** file:// uri of the decrypted bytes in app-private cache */
  uri: string
  mime: string
  kind: MediaKind
  size: number
  /** Video only: poster frame. */
  posterUri?: string
}

const inflight = new Map<string, Promise<LocalMedia>>()

function localTarget(ref: MediaRef, bucket: 'dl' | 'vo'): File {
  const ext = extensionOf(ref.name ?? '') || extensionForMime(ref.mime, 'bin')
  const name = ref.name ? safeFileName(ref.name) : `media.${ext}`
  const dir = new Directory(bucketDir(bucket), safeFileName(ref.mediaId, 'media'))
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return new File(dir, name)
}

async function withPoster(local: LocalMedia): Promise<LocalMedia> {
  if (local.kind !== 'video') return local
  try {
    const t = await createVideoThumbnail(local.uri, { quality: 0.6 })
    return { ...local, posterUri: t.path.startsWith('file://') ? t.path : `file://${t.path}` }
  } catch {
    return local
  }
}

/** Cached decrypted copy of a normal (non view-once) attachment, if present. */
export function getCachedMedia(ref: MediaRef): LocalMedia | null {
  const f = localTarget(ref, 'dl')
  if (!f.exists) return null
  return { uri: f.uri, mime: ref.mime, kind: kindFromMime(ref.mime), size: f.size ?? 0 }
}

export interface DownloadOptions {
  onProgress?: (p: number) => void
  signal?: AbortSignal
  /**
   * View-once media: the server deletes the blob on the first GET, so this must be called at most once per
   * message. Plaintext goes to the `vo` scratch bucket (never `dl`, never the gallery) and must be removed with
   * `discardViewOnce()` when the viewer closes.
   */
  viewOnce?: boolean
}

export function downloadMedia(ref: MediaRef, opts: DownloadOptions = {}): Promise<LocalMedia> {
  if (opts.viewOnce) return doDownload(ref, opts)
  const cached = getCachedMedia(ref)
  if (cached) return Promise.resolve(cached)
  const existing = inflight.get(ref.mediaId)
  if (existing) return existing
  const p = doDownload(ref, opts).finally(() => inflight.delete(ref.mediaId))
  inflight.set(ref.mediaId, p)
  return p
}

async function doDownload(ref: MediaRef, opts: DownloadOptions): Promise<LocalMedia> {
  const enc = newTempFile('tmp', 'enc')
  const target = localTarget(ref, opts.viewOnce ? 'vo' : 'dl')
  try {
    await withAuth(async headers => {
      const task = new DownloadTask(`${mediaConfig().apiBase}/api/media/${encodeURIComponent(ref.mediaId)}`, enc, {
        headers,
        signal: opts.signal,
        onProgress: ({ bytesWritten, totalBytes }) => opts.onProgress?.(totalBytes > 0 ? bytesWritten / totalBytes : 0),
      })
      await task.downloadAsync()
    }, opts.signal)
    const packed = await enc.bytes()
    let plain: Uint8Array
    try {
      plain = await decryptMediaBytes(mediaCrypto(), packed, ref.key)
    } catch {
      throw new MediaError('undecryptable', "Can't decrypt this media on this device")
    }
    if (target.exists) target.delete()
    target.create({ intermediates: true })
    await target.write(plain)
    opts.onProgress?.(1)
    return await withPoster({ uri: target.uri, mime: ref.mime, kind: kindFromMime(ref.mime), size: plain.length })
  } catch (e) {
    const err = toMediaError(e, opts.signal)
    if (err.code === 'gone') markViewOnceExpired(ref.mediaId)
    safeDelete(target)
    throw err
  } finally {
    safeDelete(enc)
  }
}

/** Remove the plaintext of a view-once item (call on viewer close / unmount). */
export function discardViewOnce(ref: Pick<MediaRef, 'mediaId'>): void {
  try {
    const dir = new Directory(bucketDir('vo'), safeFileName(ref.mediaId, 'media'))
    if (dir.exists) dir.delete()
  } catch {
    // best effort; cleanupMediaScratch() purges the bucket at next launch
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Explicit user actions (save / share) - never available for view-once
// ---------------------------------------------------------------------------------------------------------------------

export async function saveToGallery(local: LocalMedia, opts: { viewOnce?: boolean } = {}): Promise<void> {
  if (opts.viewOnce) throw new Error('View-once media cannot be saved')
  if (local.kind === 'file') throw new Error('Only photos and videos can be saved to the gallery')
  const ML = await import('expo-media-library')
  const perm = await ML.requestPermissionsAsync(true)
  if (!perm.granted) throw new MediaError('forbidden', 'Allow photo access to save media')
  await ML.Asset.create(local.uri)
}

export async function shareLocalFile(local: LocalMedia, opts: { viewOnce?: boolean } = {}): Promise<void> {
  if (opts.viewOnce) throw new Error('View-once media cannot be shared')
  const Sharing = await import('expo-sharing')
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(local.uri, { mimeType: local.mime })
}

export { randomId }

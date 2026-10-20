export type MediaKind = 'image' | 'video' | 'file'

/**
 * Plaintext inside the E2E-encrypted chat message (JSON.stringify'd, then Signal-encrypted by the messaging layer).
 * `iris`, `v`, `key`, `mime`, `caption` are the web-compatible core; the rest are optional additive hints
 * that older clients ignore (the web parser rebuilds the object from the known fields only).
 */
export interface MediaEnvelope {
  iris: 'media'
  v: 1
  /** base64 raw AES-256-GCM key (single use). */
  key: string
  /** Real MIME type. */
  mime: string
  caption: string
  /** Original file name (documents). */
  name?: string
  /** Plaintext size in bytes. */
  size?: number
  /** Pixel size, for correct bubble aspect ratio before download. */
  w?: number
  h?: number
  /** Video duration in seconds. */
  dur?: number
  /** BlurHash (4x3) placeholder shown while downloading. */
  bh?: string
}

/** A picked/captured item before processing. */
export interface MediaSource {
  /** Stable local id for list keys. */
  id: string
  kind: MediaKind
  /** file:// or content:// uri */
  uri: string
  mime: string
  name?: string
  width?: number
  height?: number
  /** seconds */
  duration?: number
  size?: number
}

/** Result of the preview/editor for one item. */
export interface EditedMedia extends MediaSource {
  caption: string
  viewOnce: boolean
  hd: boolean
}

export interface UploadedMedia {
  mediaId: string
  /** Real MIME. Only ever sent inside the encrypted envelope. */
  mimeType: string
  /** Coarse type the server may see ("image/*", "video/*", or "application/octet-stream" for documents). */
  wireMimeType: string
  /** base64 AES key. Only ever sent inside the encrypted envelope. */
  key: string
  size: number
  width?: number
  height?: number
  duration?: number
  blurhash?: string
  name?: string
}

export type TransferState = 'idle' | 'preparing' | 'encrypting' | 'uploading' | 'done' | 'error' | 'cancelled'

export interface TransferStatus {
  state: TransferState
  /** 0..1 */
  progress: number
  error?: string
}

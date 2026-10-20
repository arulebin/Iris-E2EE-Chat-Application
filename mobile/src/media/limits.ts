/** Wire limits shared with the web client (frontend/src/lib/media.ts, backend MediaController). */
export const IV_BYTES = 12
export const GCM_TAG_BYTES = 16
/** iv + GCM tag added on top of the plaintext. */
export const MEDIA_CRYPTO_OVERHEAD = IV_BYTES + GCM_TAG_BYTES
/** Server cap applies to the uploaded ciphertext. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
export const MAX_PLAINTEXT_BYTES = MAX_MEDIA_BYTES - MEDIA_CRYPTO_OVERHEAD

export const MAX_SELECTION = 30
export const MAX_VIDEO_SECONDS = 60
export const MAX_IMAGE_EDGE = 2560
export const IMAGE_QUALITY_STANDARD = 0.85
export const IMAGE_QUALITY_HD = 0.95
export const HD_MAX_IMAGE_EDGE = 4096

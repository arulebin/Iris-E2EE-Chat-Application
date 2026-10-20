import { Capacitor } from '@capacitor/core'
import { Camera } from '@capacitor/camera'

// In the Android app, hand capture to the system camera instead of grabbing a
// frame from a getUserMedia stream. The system app runs the full still-photo
// pipeline (multi-frame denoise, HDR, focus/exposure lock), so shots look the
// same as the phone's own camera. Nothing is saved to the gallery: the file
// only exists in the app's cache until it's encrypted and uploaded.

export const hasNativeCamera = (): boolean => Capacitor.isNativePlatform()

/** Thrown when the user backs out of the system camera without capturing. */
export class CaptureCancelled extends Error {}

const VIDEO_EXT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

async function toFile(webPath: string, kind: 'photo' | 'video'): Promise<File> {
  const blob = await (await fetch(webPath)).blob()
  const ext = (webPath.split('?')[0].split('.').pop() ?? '').toLowerCase()
  const type =
    kind === 'photo'
      ? 'image/jpeg'
      : blob.type.startsWith('video/') ? blob.type : (VIDEO_EXT_TYPES[ext] ?? 'video/mp4')
  const name = `${kind}-${Date.now()}.${kind === 'photo' ? 'jpg' : (ext || 'mp4')}`
  return new File([blob], name, { type })
}

// The plugin rejects with a "cancelled"-style message when the user backs out;
// normalise that so callers can tell it apart from real failures.
function normaliseError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (/cancel/i.test(msg)) throw new CaptureCancelled(msg)
  throw err instanceof Error ? err : new Error(msg)
}

export async function nativeTakePhoto(): Promise<File> {
  try {
    const res = await Camera.takePhoto({
      quality: 92,
      correctOrientation: true,
      saveToGallery: false,
      editable: 'no',
    })
    if (!res.webPath) throw new Error('Camera returned no image')
    return await toFile(res.webPath, 'photo')
  } catch (err) {
    normaliseError(err)
  }
}

export async function nativeRecordVideo(): Promise<File> {
  try {
    const res = await Camera.recordVideo({ saveToGallery: false })
    if (!res.webPath) throw new Error('Camera returned no video')
    return await toFile(res.webPath, 'video')
  } catch (err) {
    normaliseError(err)
  }
}

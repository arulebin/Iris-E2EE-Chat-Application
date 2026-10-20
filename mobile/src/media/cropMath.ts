/** `null` = keep the original aspect (full-frame window; the user trims by choosing a ratio). */
export type Aspect = number | null

/**
 * Largest crop window of the given aspect ratio (w/h) that fits inside an image of imgW x imgH.
 * With `null` the window is a 85% inset of the image so the user can still shave the edges.
 */
export function cropWindow(imgW: number, imgH: number, ratio: Aspect): { width: number; height: number } {
  if (ratio == null) return { width: imgW * 0.85, height: imgH * 0.85 }
  const imgRatio = imgW / imgH
  if (imgRatio > ratio) return { width: imgH * ratio, height: imgH }
  return { width: imgW, height: imgW / ratio }
}

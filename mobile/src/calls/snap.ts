// Geometry for the draggable call tiles (self-view and the minimized call
// window): where a tile settles when released, and the drag-to-dismiss target.
// Pure functions so the feel can be unit-tested without a DOM.

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }
export type Insets = { top: number; right: number; bottom: number; left: number }

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/** How far ahead (ms) a release velocity is projected — a flick carries the tile. */
const MOMENTUM_MS = 220

export function clamp(v: number, lo: number, hi: number): number {
  'worklet'
  return Math.min(hi, Math.max(lo, v))
}

function bounds(tile: Size, viewport: Size, insets: Insets, margin: number) {
  'worklet'
  return {
    minX: insets.left + margin,
    maxX: Math.max(insets.left + margin, viewport.w - insets.right - margin - tile.w),
    minY: insets.top + margin,
    maxY: Math.max(insets.top + margin, viewport.h - insets.bottom - margin - tile.h),
  }
}

/** Top-left position the tile is projected to after a release with `velocity` (px/ms). */
export function project(pos: Point, velocity: Point): Point {
  'worklet'
  return { x: pos.x + velocity.x * MOMENTUM_MS, y: pos.y + velocity.y * MOMENTUM_MS }
}

/** Self-view: settle in the corner nearest the projected position. */
export function snapToCorner(
  pos: Point, velocity: Point, tile: Size, viewport: Size, insets: Insets = NO_INSETS, margin = 12,
): Point {
  'worklet'
  const b = bounds(tile, viewport, insets, margin)
  const p = project(pos, velocity)
  const cx = p.x + tile.w / 2
  const cy = p.y + tile.h / 2
  return {
    x: cx < viewport.w / 2 ? b.minX : b.maxX,
    y: cy < viewport.h / 2 ? b.minY : b.maxY,
  }
}

/** Minimized call window: stick to the nearer side edge, keep its height (clamped). */
export function snapToEdge(
  pos: Point, velocity: Point, tile: Size, viewport: Size, insets: Insets = NO_INSETS, margin = 12,
): Point {
  'worklet'
  const b = bounds(tile, viewport, insets, margin)
  const p = project(pos, velocity)
  return {
    x: p.x + tile.w / 2 < viewport.w / 2 ? b.minX : b.maxX,
    y: clamp(p.y, b.minY, b.maxY),
  }
}

/** Keep a tile fully on screen while it is being dragged. */
export function clampToViewport(pos: Point, tile: Size, viewport: Size, insets: Insets = NO_INSETS): Point {
  'worklet'
  const b = bounds(tile, viewport, insets, 0)
  return { x: clamp(pos.x, b.minX, b.maxX), y: clamp(pos.y, b.minY, b.maxY) }
}

export type DismissZone = { cx: number; cy: number; r: number }

/** Drop target at the bottom-centre, like Android chat bubbles. */
export function dismissZone(viewport: Size, insets: Insets = NO_INSETS): DismissZone {
  'worklet'
  return { cx: viewport.w / 2, cy: viewport.h - insets.bottom - 72, r: 56 }
}

/** Is the dragged tile's centre over the dismiss target? */
export function overDismiss(pos: Point, tile: Size, zone: DismissZone): boolean {
  'worklet'
  const dx = pos.x + tile.w / 2 - zone.cx
  const dy = pos.y + tile.h / 2 - zone.cy
  return Math.hypot(dx, dy) <= zone.r + Math.min(tile.w, tile.h) / 4
}

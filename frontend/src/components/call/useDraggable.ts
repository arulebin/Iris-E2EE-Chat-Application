import { useCallback, useEffect, useRef, useState } from "react";
import { clampToViewport, type Insets, type Point, type Size } from "../../lib/call/snap";

const TAP_SLOP_PX = 6;

/** Current safe-area insets (notch, gesture bar), read from CSS env(). */
export function useSafeInsets(): Insets {
  const read = (): Insets => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const insets = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    probe.remove();
    return insets;
  };
  const [insets, setInsets] = useState<Insets>(read);
  useEffect(() => {
    const onResize = () => setInsets(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return insets;
}

export function useViewport(): Size {
  const [vp, setVp] = useState<Size>({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vp;
}

type Options = {
  size: Size;
  insets: Insets;
  /** Where the tile starts / returns to when the viewport changes. */
  initial: (viewport: Size) => Point;
  /** Where the tile settles after a release (corner, edge …). */
  settle: (pos: Point, velocity: Point, viewport: Size) => Point;
  onTap?: () => void;
  onMove?: (pos: Point) => void;
  /** Return true to consume the release (e.g. dropped on the dismiss target). */
  onDrop?: (pos: Point) => boolean;
};

/**
 * Pointer-driven drag with a momentum "throw" and a springy settle: the tile
 * follows the finger 1:1, and on release the release velocity projects where it
 * lands, then a CSS transition with a slight overshoot carries it there.
 */
export function useDraggable({ size, insets, initial, settle, onTap, onMove, onDrop }: Options) {
  const viewport = useViewport();
  const [pos, setPosValue] = useState<Point>(() => initial(viewport));
  const posRef = useRef(pos);
  const setPos = useCallback((next: Point | ((p: Point) => Point)) => {
    const value = typeof next === "function" ? next(posRef.current) : next;
    posRef.current = value;
    setPosValue(value);
  }, []);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ start: Point; origin: Point; last: Point; lastT: number; v: Point; moved: boolean } | null>(null);

  // Re-settle when the screen rotates / resizes (or PiP changes the size).
  useEffect(() => {
    setPos((p) => settle(clampToViewport(p, size, viewport, insets), { x: 0, y: 0 }, viewport));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.w, viewport.h, size.w, size.h]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const now = performance.now();
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: posRef.current, last: { x: e.clientX, y: e.clientY }, lastT: now, v: { x: 0, y: 0 }, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    // Smoothed velocity (px/ms) so one jittery sample doesn't fling the tile.
    d.v = {
      x: 0.7 * ((e.clientX - d.last.x) / dt) + 0.3 * d.v.x,
      y: 0.7 * ((e.clientY - d.last.y) / dt) + 0.3 * d.v.y,
    };
    d.last = { x: e.clientX, y: e.clientY };
    d.lastT = now;
    const next = clampToViewport({ x: d.origin.x + dx, y: d.origin.y + dy }, size, viewport, insets);
    setPos(next);
    onMove?.(next);
  }, [size, viewport, insets, onMove, setPos]);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) { onTap?.(); return; }
    setDragging(false);
    // Stale velocity if the finger paused before lifting.
    const v = performance.now() - d.lastT > 80 ? { x: 0, y: 0 } : d.v;
    const p = posRef.current;
    if (onDrop?.(p)) return;
    setPos(settle(p, v, viewport));
  }, [onTap, onDrop, settle, viewport, setPos]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: 0,
    top: 0,
    width: size.w,
    height: size.h,
    transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
    transition: dragging ? "none" : "transform 380ms cubic-bezier(0.22, 1.25, 0.36, 1)",
    touchAction: "none",
  };

  return {
    pos,
    dragging,
    style,
    viewport,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

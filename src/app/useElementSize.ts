// Tracks an element's content box with a ResizeObserver (null until measured).
import { useEffect, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

export function useElementSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0) setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Width to draw a diagram of the given aspect (height / width) so it fits the box,
 * clamped to [min, max]. Without a measurement it falls back to `fallback`.
 */
export function fitWidth(box: Size | null, aspect: number, { min = 320, max = 1400, fallback = 720 } = {}): number {
  if (!box) return fallback;
  let w = box.width;
  if (box.height > 0 && aspect > 0) w = Math.min(w, box.height / aspect);
  return Math.round(Math.max(min, Math.min(max, w)));
}

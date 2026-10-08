import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

export const HOLD_DELAY_MS = 350;
export const REPEAT_MS = 60;

/**
 * Hold-to-repeat button handlers: fires once on press, then repeatedly while held.
 * Keyboard activation (click with detail 0) fires once.
 *
 * `fire` gets the real seconds since the previous fire for repeats (undefined for the first
 * press), so a held button reports the feed rate it actually produces.
 *
 * The pointer is captured on press, so the release is seen even off the button; leaving the
 * button also stops (where capture is unsupported). Repeating also stops as soon as the button becomes disabled (a disabled button
 * never gets its pointerup) and when the component unmounts.
 */
export function useHoldRepeat(fire: (repeatDt?: number) => void, disabled = false) {
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = useRef(0);

  const stop = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    if (interval.current) clearInterval(interval.current);
    timeout.current = null;
    interval.current = null;
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return;
      stop();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      fireRef.current();
      last.current = performance.now();
      timeout.current = setTimeout(() => {
        interval.current = setInterval(() => {
          const now = performance.now();
          const dt = (now - last.current) / 1000;
          last.current = now;
          fireRef.current(dt > 0 ? dt : REPEAT_MS / 1000);
        }, REPEAT_MS);
      }, HOLD_DELAY_MS);
    },
    [disabled, stop],
  );

  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      // pointer presses already fired in onPointerDown; detail 0 = keyboard/programmatic click
      if (!disabled && e.detail === 0) fireRef.current();
    },
    [disabled],
  );

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onLostPointerCapture: stop, onClick };
}

// Drives the simulation when the 3D scene isn't mounted. Normally LatheScene's single useFrame
// calls tick(dt); without it (3D turned off, or no WebGL) lessons would never advance.
import { useEffect } from 'react';
import { useLathe } from '../store';

/** Same clamp the scene uses, so a stalled tab doesn't make the sim jump. */
export const FALLBACK_MAX_DT = 0.05;

export function useFallbackTicker(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let last: number | null = null;
    const step = (now: number) => {
      if (last !== null) {
        const dt = Math.min((now - last) / 1000, FALLBACK_MAX_DT);
        if (dt > 0) useLathe.getState().tick(dt);
      }
      last = now;
    };
    if (typeof requestAnimationFrame === 'function') {
      let id = 0;
      const loop = (now: number) => {
        step(now);
        id = requestAnimationFrame(loop);
      };
      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }
    const id = setInterval(() => step(performance.now()), 1000 / 60);
    return () => clearInterval(id);
  }, [active]);
}

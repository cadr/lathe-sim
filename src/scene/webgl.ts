// WebGL probe, kept in its own module (no three / R3F imports) so the app shell can call it
// without pulling the lazily loaded 3D chunk into the main bundle.

/** True when a WebGL context can be created (false in jsdom and GPU-less browsers). */
export function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  // jsdom has no WebGL and logs "not implemented" on getContext
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const canvas = document.createElement('canvas');
    const ctx = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    // release the probe context right away so it doesn't count against the browser's context limit
    ctx?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!ctx;
  } catch {
    return false;
  }
}

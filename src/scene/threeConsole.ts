// Routes three.js log output through a filter, using three's own setConsoleFunction hook.
// @react-three/fiber 8.18 (the newest 8.x) still creates a THREE.Clock for its frame loop, and
// three r183+ warns that Clock is deprecated in favor of Timer. The warning is about R3F's
// internals, not this app, so it is dropped. Every other three message passes through unchanged.
import { setConsoleFunction } from 'three';

type LogType = 'log' | 'warn' | 'error';

/** Exact-prefix patterns for known, harmless three.js messages. */
export const SUPPRESSED_THREE_MESSAGES: readonly RegExp[] = [/^THREE\.Clock: This module has been deprecated/];

export function shouldSuppressThreeMessage(type: LogType, message: string): boolean {
  return type === 'warn' && SUPPRESSED_THREE_MESSAGES.some((re) => re.test(message));
}

let installed = false;

export function installThreeConsoleFilter(): void {
  if (installed) return;
  installed = true;
  setConsoleFunction((type, message, ...params) => {
    if (shouldSuppressThreeMessage(type, message)) return;
    console[type](message, ...params);
  });
}

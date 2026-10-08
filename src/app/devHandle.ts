// Dev / e2e only: expose the store as window.__lathe so tests can do long traverses quickly.
import { useLathe } from '../store';

declare global {
  interface Window {
    __lathe?: typeof useLathe;
  }
}

export function devHandleEnabled(dev: boolean, search: string): boolean {
  return dev || new URLSearchParams(search).get('e2e') === '1';
}

export function exposeDevHandle(): void {
  if (typeof window === 'undefined') return;
  if (devHandleEnabled(import.meta.env.DEV, window.location.search)) window.__lathe = useLathe;
}

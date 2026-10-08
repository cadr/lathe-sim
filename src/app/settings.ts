// User settings for the app shell. The only one so far: turn the 3D view off.
import { useCallback, useState } from 'react';

export const NO3D_STORAGE_KEY = 'lathe-sim.no3d';

/** True when the URL asks for no 3D view (`?no3d=1` or `?no3d=true`). */
export function no3dFromQuery(search: string): boolean {
  const v = new URLSearchParams(search).get('no3d');
  return v === '1' || v === 'true';
}

/** Saved "disable 3D" preference. Storage can be missing or blocked, which reads as off. */
export function loadNo3d(): boolean {
  try {
    return globalThis.localStorage?.getItem(NO3D_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveNo3d(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(NO3D_STORAGE_KEY, '1');
    else globalThis.localStorage?.removeItem(NO3D_STORAGE_KEY);
  } catch {
    // private mode or blocked storage: the setting just won't persist
  }
}

export interface No3dSetting {
  /** the 3D view is off, for either reason */
  off: boolean;
  /** forced off by the URL; the settings toggle can't override it */
  forced: boolean;
  /** the saved preference */
  saved: boolean;
  setSaved(on: boolean): void;
}

export function useNo3dSetting(search: string = typeof location === 'undefined' ? '' : location.search): No3dSetting {
  const [forced] = useState(() => no3dFromQuery(search));
  const [saved, setSavedState] = useState(loadNo3d);
  const setSaved = useCallback((on: boolean) => {
    saveNo3d(on);
    setSavedState(on);
  }, []);
  return { off: forced || saved, forced, saved, setSaved };
}

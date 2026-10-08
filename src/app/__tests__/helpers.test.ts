import { describe, expect, it, vi } from 'vitest';
import { devHandleEnabled } from '../devHandle';
import { NO3D_STORAGE_KEY, loadNo3d, no3dFromQuery, saveNo3d } from '../settings';
import { FALLBACK_MAX_DT } from '../useFallbackTicker';
import { fitWidth } from '../useElementSize';
import { shouldSuppressThreeMessage } from '../../scene/threeConsole';

describe('settings', () => {
  it('reads ?no3d from the query string', () => {
    expect(no3dFromQuery('?no3d=1')).toBe(true);
    expect(no3dFromQuery('?e2e=1&no3d=true')).toBe(true);
    expect(no3dFromQuery('?no3d=0')).toBe(false);
    expect(no3dFromQuery('')).toBe(false);
  });

  it('saves and loads the preference', () => {
    saveNo3d(true);
    expect(localStorage.getItem(NO3D_STORAGE_KEY)).toBe('1');
    expect(loadNo3d()).toBe(true);
    saveNo3d(false);
    expect(loadNo3d()).toBe(false);
  });

  it('treats blocked storage as off and never throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadNo3d()).toBe(false);
    expect(() => saveNo3d(true)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('dev handle', () => {
  it('is on in dev or with ?e2e=1', () => {
    expect(devHandleEnabled(true, '')).toBe(true);
    expect(devHandleEnabled(false, '?e2e=1')).toBe(true);
    expect(devHandleEnabled(false, '?no3d=1')).toBe(false);
  });
});

describe('fallback ticker', () => {
  it('clamps like the scene loop', () => {
    expect(FALLBACK_MAX_DT).toBe(0.05);
  });
});

describe('three console filter', () => {
  it('drops only the THREE.Clock deprecation warning', () => {
    expect(shouldSuppressThreeMessage('warn', 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.')).toBe(true);
    expect(shouldSuppressThreeMessage('error', 'THREE.Clock: This module has been deprecated.')).toBe(false);
    expect(shouldSuppressThreeMessage('warn', 'THREE.WebGLRenderer: Context Lost.')).toBe(false);
  });
});

describe('fitWidth', () => {
  it('fits both dimensions and clamps', () => {
    expect(fitWidth(null, 0.5)).toBe(720);
    expect(fitWidth({ width: 1000, height: 1000 }, 0.5)).toBe(1000);
    expect(fitWidth({ width: 1000, height: 300 }, 0.5)).toBe(600);
    expect(fitWidth({ width: 1000, height: 100 }, 0.5)).toBe(320);
    expect(fitWidth({ width: 3000, height: 0 }, 0.5)).toBe(1400);
  });
});
